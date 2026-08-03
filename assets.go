package csplayerstatsradar

import (
	"embed"
	"io/fs"
)

//go:embed frontend/dist
var frontendFiles embed.FS

func FrontendFS() fs.FS {
	sub, err := fs.Sub(frontendFiles, "frontend/dist")
	if err != nil {
		panic(err)
	}
	return sub
}
