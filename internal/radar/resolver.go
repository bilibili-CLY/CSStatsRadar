package radar

import "strings"

type PlayerResolver struct{}

func (r PlayerResolver) Resolve(players []Player, identifierType IdentifierType, identifier string) (Player, *AppError) {
	cleaned := cleanIdentifier(identifier)
	if cleaned == "" {
		return Player{}, notFound(players)
	}
	switch identifierType {
	case IdentifierSteamID:
		for _, player := range players {
			if strings.TrimSpace(player.SteamID) == cleaned {
				return player, nil
			}
		}
		return Player{}, notFound(players)
	case IdentifierName:
		var matches []Player
		for _, player := range players {
			if cleanIdentifier(player.Name) == cleaned {
				matches = append(matches, player)
			}
		}
		if len(matches) == 1 {
			return matches[0], nil
		}
		if len(matches) > 1 {
			return Player{}, NewAppError("player_ambiguous", httpStatusConflict, "", map[string]any{"candidates": matches})
		}
		return Player{}, notFound(players)
	default:
		return Player{}, notFound(players)
	}
}

func cleanIdentifier(value string) string {
	return strings.Join(strings.Fields(strings.TrimSpace(value)), " ")
}

func notFound(players []Player) *AppError {
	return NewAppError("player_not_found", httpStatusNotFound, "", map[string]any{"candidates": players})
}
