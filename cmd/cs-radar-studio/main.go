package main

import (
	"log"

	csplayerstatsradar "csplayerstatsradar"
	"csplayerstatsradar/internal/radar"
	"github.com/wailsapp/wails/v2"
	"github.com/wailsapp/wails/v2/pkg/options"
	macoptions "github.com/wailsapp/wails/v2/pkg/options/mac"
)

func main() {
	app, err := radar.NewDesktopApp()
	if err != nil {
		log.Fatal(err)
	}
	if err := wails.Run(&options.App{
		Title:            "CS2 雷达内容工作台",
		Width:            1440,
		Height:           900,
		MinWidth:         1180,
		MinHeight:        720,
		Assets:           csplayerstatsradar.FrontendFS(),
		BackgroundColour: &options.RGBA{R: 12, G: 13, B: 15, A: 1},
		Mac: &macoptions.Options{
			Preferences: &macoptions.Preferences{FullscreenEnabled: macoptions.Enabled},
		},
		OnStartup:  app.Startup,
		OnShutdown: app.Shutdown,
		Bind:       []interface{}{app},
	}); err != nil {
		log.Fatal(err)
	}
}
