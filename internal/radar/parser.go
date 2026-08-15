package radar

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	demoinfocs "github.com/markus-wa/demoinfocs-golang/v5/pkg/demoinfocs"
	"github.com/markus-wa/demoinfocs-golang/v5/pkg/demoinfocs/common"
	"github.com/markus-wa/demoinfocs-golang/v5/pkg/demoinfocs/events"
	"github.com/markus-wa/demoinfocs-golang/v5/pkg/demoinfocs/msg"
)

type DemoParser interface {
	Parse(filePath string) (DemoData, *AppError)
}

type JSONFixtureParser struct{}

func (p JSONFixtureParser) Parse(filePath string) (DemoData, *AppError) {
	data, err := os.ReadFile(filePath)
	if err != nil {
		return DemoData{}, NewAppError("demo_parse_failed", httpStatusBadRequest, "Demo 文件不存在。", nil)
	}
	trimmed := bytes.TrimSpace(data)
	if len(trimmed) == 0 || trimmed[0] != '{' {
		return DemoinfocsParser{}.Parse(filePath)
	}
	var raw struct {
		Players            []Player        `json:"players"`
		Rounds             []RoundData     `json:"rounds"`
		Kills              []KillEvent     `json:"kills"`
		Damages            *[]DamageEvent  `json:"damages"`
		Survivals          []SurvivalState `json:"survivals"`
		TradeDataAvailable *bool           `json:"trade_data_available"`
		Meta               struct {
			MatchTime  *string `json:"match_time"`
			MapName    string  `json:"map_name"`
			ServerName string  `json:"server_name"`
		} `json:"meta"`
	}
	if err := json.Unmarshal(trimmed, &raw); err != nil {
		return DemoData{}, NewAppError("demo_parse_failed", httpStatusBadRequest, "Demo fixture 结构无效："+err.Error(), nil)
	}
	if len(raw.Players) == 0 {
		return DemoData{}, NewAppError("demo_parse_failed", httpStatusBadRequest, "Demo fixture 缺少玩家列表。", nil)
	}
	tradeDataAvailable := true
	if raw.TradeDataAvailable != nil {
		tradeDataAvailable = *raw.TradeDataAvailable
	}
	meta := DemoMeta{
		MapName:    raw.Meta.MapName,
		ServerName: raw.Meta.ServerName,
		FileSHA256: hashBytes(trimmed),
	}
	if raw.Meta.MatchTime != nil && *raw.Meta.MatchTime != "" {
		parsed, err := time.Parse(time.RFC3339, *raw.Meta.MatchTime)
		if err != nil {
			return DemoData{}, NewAppError("demo_parse_failed", httpStatusBadRequest, "Demo fixture meta.match_time 无效："+err.Error(), nil)
		}
		utc := parsed.UTC()
		meta.MatchTime = &utc
	}
	return DemoData{
		Players:            raw.Players,
		Rounds:             raw.Rounds,
		Kills:              raw.Kills,
		Damages:            raw.Damages,
		Survivals:          raw.Survivals,
		TradeDataAvailable: tradeDataAvailable,
		Source:             "fixture:" + filepath.Base(filePath),
		Meta:               meta,
	}, nil
}

type DemoinfocsParser struct{}

func (p DemoinfocsParser) Parse(filePath string) (data DemoData, appErr *AppError) {
	file, err := os.Open(filePath)
	if err != nil {
		return DemoData{}, NewAppError("demo_parse_failed", httpStatusBadRequest, "Demo 文件不存在。", nil)
	}
	defer file.Close()

	var builder *demoinfocsDataBuilder
	defer func() {
		if recovered := recover(); recovered != nil {
			if builder != nil && isRecoverableDemoinfocsPanic(recovered) {
				builder.discardOpenRound()
				partial := builder.data()
				if len(partial.Players) > 0 && len(partial.Rounds) > 0 {
					data = partial
					appErr = nil
					return
				}
			}
			data = DemoData{}
			appErr = NewAppError("demo_parse_failed", httpStatusBadRequest, fmt.Sprintf("Demo 解析失败：%v", recovered), nil)
		}
	}()

	parser := demoinfocs.NewParser(file)
	defer parser.Close()

	builder = newDemoinfocsDataBuilder(parser)
	builder.meta.FileSHA256 = hashBytesFromFile(filePath)
	parser.RegisterNetMessageHandler(func(serverInfo *msg.CSVCMsg_ServerInfo) {
		if serverInfo.GetMapName() != "" {
			builder.meta.MapName = serverInfo.GetMapName()
		}
	})
	parser.RegisterEventHandler(func(e events.RoundStart) {
		if parser.GameState().IsWarmupPeriod() {
			return
		}
		builder.startRound()
	})
	parser.RegisterEventHandler(func(e events.RoundFreezetimeEnd) {
		if parser.GameState().IsWarmupPeriod() {
			return
		}
		builder.collectPlayers(parser.GameState().Participants().Playing())
		builder.captureRoundEconomy()
	})
	parser.RegisterEventHandler(func(e events.Kill) {
		builder.addKill(e, parser.GameState().IsWarmupPeriod())
	})
	parser.RegisterEventHandler(func(e events.PlayerHurt) {
		builder.addDamage(e, parser.GameState().IsWarmupPeriod())
	})
	parser.RegisterEventHandler(func(e events.BombPlanted) { builder.markBombPlanted(e.Player) })
	parser.RegisterEventHandler(func(e events.BombDefused) { builder.markBombDefused(e.Player) })
	parser.RegisterEventHandler(func(e events.RoundEnd) {
		if parser.GameState().IsWarmupPeriod() {
			return
		}
		builder.endRound(e)
	})

	if err := parser.ParseToEnd(); err != nil {
		return DemoData{}, NewAppError("demo_parse_failed", httpStatusBadRequest, "Demo 解析失败："+err.Error(), nil)
	}
	builder.collectPlayers(parser.GameState().Participants().All())

	result := builder.data()
	if len(result.Players) == 0 {
		return DemoData{}, NewAppError("demo_parse_failed", httpStatusBadRequest, "Demo 解析失败：未识别到玩家列表。", nil)
	}
	if len(result.Rounds) == 0 {
		return DemoData{}, NewAppError("demo_parse_failed", httpStatusBadRequest, "Demo 解析失败：未识别到有效回合。", nil)
	}
	return result, nil
}

func isRecoverableDemoinfocsPanic(recovered any) bool {
	return strings.Contains(fmt.Sprint(recovered), "cannot parse invalid wire-format data")
}

type demoinfocsDataBuilder struct {
	parser       demoinfocs.Parser
	currentRound int
	roundOpen    bool
	players      map[string]Player
	rounds       []RoundData
	kills        []KillEvent
	damages      []DamageEvent
	survivals    []SurvivalState
	meta         DemoMeta
}

func newDemoinfocsDataBuilder(parser demoinfocs.Parser) *demoinfocsDataBuilder {
	return &demoinfocsDataBuilder{
		parser:  parser,
		players: map[string]Player{},
	}
}

func (b *demoinfocsDataBuilder) startRound() {
	b.currentRound++
	b.roundOpen = true
	b.rounds = append(b.rounds, RoundData{RoundNumber: b.currentRound})
	b.collectPlayers(b.parser.GameState().Participants().Playing())
}

func (b *demoinfocsDataBuilder) ensureRound() int {
	if b.currentRound == 0 {
		b.startRound()
	}
	return b.currentRound
}

func (b *demoinfocsDataBuilder) addKill(event events.Kill, isWarmup bool) {
	if isWarmup || b.currentRound == 0 {
		return
	}
	roundNumber := b.currentRound
	killer := playerID(event.Killer)
	victim := playerID(event.Victim)
	assister := playerID(event.Assister)
	killerSide, victimSide := playerSide(event.Killer), playerSide(event.Victim)
	if killer == "" || victim == "" || killer == victim || (killerSide != "" && killerSide == victimSide) {
		return
	}
	b.collectPlayer(event.Killer)
	b.collectPlayer(event.Victim)
	b.collectPlayer(event.Assister)
	kill := KillEvent{
		RoundNumber:       roundNumber,
		Tick:              b.currentTick(),
		AttackerSteamID:   killer,
		VictimSteamID:     victim,
		AssisterSteamID:   assister,
		AttackerSide:      playerSide(event.Killer),
		VictimSide:        playerSide(event.Victim),
		Weapon:            equipmentName(event.Weapon),
		VictimWeapon:      activeWeaponName(event.Victim),
		AttackerArmor:     playerArmor(event.Killer),
		VictimArmor:       playerArmor(event.Victim),
		AttackerEquipment: playerEquipment(event.Killer),
		VictimEquipment:   playerEquipment(event.Victim),
		AssistedFlash:     event.AssistedFlash,
	}
	for index := len(b.kills) - 1; index >= 0; index-- {
		previous := b.kills[index]
		if previous.RoundNumber != roundNumber || kill.Tick-previous.Tick > 5*64 {
			break
		}
		if previous.AttackerSteamID == kill.VictimSteamID && strings.EqualFold(previous.VictimSide, kill.AttackerSide) {
			kill.TradedPlayerSteamID = previous.VictimSteamID
			break
		}
	}
	b.kills = append(b.kills, kill)
}

func (b *demoinfocsDataBuilder) addDamage(event events.PlayerHurt, isWarmup bool) {
	if isWarmup || b.currentRound == 0 {
		return
	}
	roundNumber := b.currentRound
	attacker := playerID(event.Attacker)
	victim := playerID(event.Player)
	if attacker == "" || victim == "" || event.HealthDamageTaken <= 0 {
		return
	}
	attackerSide, victimSide := playerSide(event.Attacker), playerSide(event.Player)
	if attacker == victim || (attackerSide != "" && attackerSide == victimSide) {
		return
	}
	b.collectPlayer(event.Attacker)
	b.collectPlayer(event.Player)
	b.damages = append(b.damages, DamageEvent{
		RoundNumber:       roundNumber,
		Tick:              b.currentTick(),
		AttackerSteamID:   attacker,
		VictimSteamID:     victim,
		Damage:            event.HealthDamageTaken,
		AttackerSide:      playerSide(event.Attacker),
		VictimSide:        playerSide(event.Player),
		Weapon:            equipmentName(event.Weapon),
		VictimWeapon:      activeWeaponName(event.Player),
		AttackerArmor:     playerArmor(event.Attacker),
		VictimArmor:       playerArmor(event.Player),
		AttackerEquipment: playerEquipment(event.Attacker),
		VictimEquipment:   playerEquipment(event.Player),
	})
}

func (b *demoinfocsDataBuilder) endRound(event events.RoundEnd) {
	roundNumber := b.ensureRound()
	if len(b.rounds) > 0 {
		b.rounds[len(b.rounds)-1].WinnerSide = teamSide(event.Winner)
	}
	playing := b.parser.GameState().Participants().Playing()
	b.collectPlayers(playing)
	for _, player := range playing {
		id := playerID(player)
		if id == "" {
			continue
		}
		b.survivals = append(b.survivals, SurvivalState{
			RoundNumber: roundNumber,
			SteamID:     id,
			Survived:    player.IsAlive(),
			Side:        playerSide(player),
		})
	}
	b.roundOpen = false
}

func (b *demoinfocsDataBuilder) captureRoundEconomy() {
	if len(b.rounds) == 0 {
		return
	}
	state := b.parser.GameState()
	b.rounds[len(b.rounds)-1].TeamEconomy = map[string]int{
		"T":  state.TeamTerrorists().FreezeTimeEndEquipmentValue(),
		"CT": state.TeamCounterTerrorists().FreezeTimeEndEquipmentValue(),
	}
}

func (b *demoinfocsDataBuilder) markBombPlanted(player *common.Player) {
	if len(b.rounds) == 0 {
		return
	}
	b.rounds[len(b.rounds)-1].BombPlanted = true
	b.rounds[len(b.rounds)-1].BombPlantTick = b.currentTick()
	b.rounds[len(b.rounds)-1].BombPlanterID = playerID(player)
}

func (b *demoinfocsDataBuilder) markBombDefused(player *common.Player) {
	if len(b.rounds) == 0 {
		return
	}
	b.rounds[len(b.rounds)-1].BombDefuserID = playerID(player)
}

func (b *demoinfocsDataBuilder) currentTick() int {
	if b.parser == nil {
		return 0
	}
	return b.parser.GameState().IngameTick()
}

func (b *demoinfocsDataBuilder) discardOpenRound() {
	if !b.roundOpen || b.currentRound == 0 {
		return
	}

	roundNumber := b.currentRound
	if len(b.rounds) > 0 && b.rounds[len(b.rounds)-1].RoundNumber == roundNumber {
		b.rounds = b.rounds[:len(b.rounds)-1]
	}
	b.kills = discardRoundKills(b.kills, roundNumber)
	b.damages = discardRoundDamages(b.damages, roundNumber)
	b.survivals = discardRoundSurvivals(b.survivals, roundNumber)
	b.roundOpen = false
}

func discardRoundKills(events []KillEvent, roundNumber int) []KillEvent {
	result := events[:0]
	for _, event := range events {
		if event.RoundNumber != roundNumber {
			result = append(result, event)
		}
	}
	return result
}

func discardRoundDamages(events []DamageEvent, roundNumber int) []DamageEvent {
	result := events[:0]
	for _, event := range events {
		if event.RoundNumber != roundNumber {
			result = append(result, event)
		}
	}
	return result
}

func discardRoundSurvivals(states []SurvivalState, roundNumber int) []SurvivalState {
	result := states[:0]
	for _, state := range states {
		if state.RoundNumber != roundNumber {
			result = append(result, state)
		}
	}
	return result
}

func (b *demoinfocsDataBuilder) collectPlayers(players []*common.Player) {
	for _, player := range players {
		b.collectPlayer(player)
	}
}

func (b *demoinfocsDataBuilder) collectPlayer(player *common.Player) {
	id := playerID(player)
	if id == "" {
		return
	}
	b.players[id] = Player{Name: player.Name, SteamID: id}
}

func (b *demoinfocsDataBuilder) data() DemoData {
	players := make([]Player, 0, len(b.players))
	for _, player := range b.players {
		players = append(players, player)
	}
	return DemoData{
		Players:            players,
		Rounds:             b.rounds,
		Kills:              b.kills,
		Damages:            &b.damages,
		Survivals:          b.survivals,
		TradeDataAvailable: true,
		Source:             "demoinfocs",
		Meta:               b.meta,
	}
}

func playerID(player *common.Player) string {
	if player == nil || player.SteamID64 == 0 || player.IsUnknown {
		return ""
	}
	return strconv.FormatUint(player.SteamID64, 10)
}

func teamSide(team common.Team) string {
	if team == common.TeamTerrorists {
		return "T"
	}
	if team == common.TeamCounterTerrorists {
		return "CT"
	}
	return ""
}

func playerSide(player *common.Player) string {
	if player == nil {
		return ""
	}
	return teamSide(player.Team)
}
func playerArmor(player *common.Player) bool { return player != nil && player.Armor() > 0 }
func playerEquipment(player *common.Player) int {
	if player == nil {
		return 0
	}
	return player.EquipmentValueCurrent()
}
func equipmentName(equipment *common.Equipment) string {
	if equipment == nil {
		return ""
	}
	return equipment.String()
}

func activeWeaponName(player *common.Player) (name string) {
	if player == nil {
		return ""
	}
	defer func() {
		if recover() != nil {
			name = ""
		}
	}()
	return equipmentName(player.ActiveWeapon())
}

func hashBytes(data []byte) string {
	sum := sha256.Sum256(data)
	return hex.EncodeToString(sum[:])
}

func hashBytesFromFile(filePath string) string {
	data, err := os.ReadFile(filePath)
	if err != nil {
		return ""
	}
	return hashBytes(data)
}
