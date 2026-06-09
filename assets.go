package csplayerstatsradar

import (
	"embed"
	"io/fs"
)

//go:embed frontend/*
var frontendFiles embed.FS

func FrontendFS() fs.FS {
	sub, err := fs.Sub(frontendFiles, "frontend")
	if err != nil {
		panic(err)
	}
	return sub
}
