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
	})
	parser.RegisterEventHandler(func(e events.Kill) {
		builder.addKill(e, parser.GameState().IsWarmupPeriod())
	})
	parser.RegisterEventHandler(func(e events.PlayerHurt) {
		builder.addDamage(e, parser.GameState().IsWarmupPeriod())
	})
	parser.RegisterEventHandler(func(e events.RoundEnd) {
		if parser.GameState().IsWarmupPeriod() {
			return
		}
		builder.endRound()
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
	b.collectPlayer(event.Killer)
	b.collectPlayer(event.Victim)
	b.collectPlayer(event.Assister)
	b.kills = append(b.kills, KillEvent{
		RoundNumber:     roundNumber,
		AttackerSteamID: killer,
		VictimSteamID:   victim,
		AssisterSteamID: assister,
	})
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
	b.collectPlayer(event.Attacker)
	b.collectPlayer(event.Player)
	b.damages = append(b.damages, DamageEvent{
		RoundNumber:     roundNumber,
		AttackerSteamID: attacker,
		VictimSteamID:   victim,
		Damage:          event.HealthDamageTaken,
	})
}

func (b *demoinfocsDataBuilder) endRound() {
	roundNumber := b.ensureRound()
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
		})
	}
	b.roundOpen = false
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
		TradeDataAvailable: false,
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
