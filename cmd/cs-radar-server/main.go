package main

import (
	"log"
	"net/http"
	"os"

	csplayerstatsradar "csplayerstatsradar"
	"csplayerstatsradar/internal/radar"
)

func main() {
	addr := os.Getenv("CS_RADAR_ADDR")
	if addr == "" {
		addr = "127.0.0.1:8000"
	}

	server := radar.NewServer(radar.ServerOptions{
		StaticFS: csplayerstatsradar.FrontendFS(),
	})

	log.Printf("CS2 Radar Studio running at http://%s", addr)
	if err := http.ListenAndServe(addr, server.Routes()); err != nil {
		log.Fatal(err)
	}
}
