package main

import (
	"log"
	"net"
	"net/http"
	"os"
	"os/exec"
	"runtime"
	"strings"

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

	listener, err := net.Listen("tcp", addr)
	if err != nil {
		log.Fatal(err)
	}
	url := startupURL(listener.Addr().String())
	log.Printf("CS2 Radar Studio running at %s", url)
	if err := openBrowser(url); err != nil {
		log.Printf("open browser failed: %v", err)
	}
	if err := http.Serve(listener, server.Routes()); err != nil {
		log.Fatal(err)
	}
}

func startupURL(addr string) string {
	host, port, err := net.SplitHostPort(addr)
	if err != nil {
		return "http://" + addr
	}
	if host == "" || host == "0.0.0.0" || host == "::" || host == "[::]" {
		host = "127.0.0.1"
	}
	host = strings.Trim(host, "[]")
	return "http://" + net.JoinHostPort(host, port) + "/"
}

func openBrowser(url string) error {
	var cmd *exec.Cmd
	switch runtime.GOOS {
	case "darwin":
		cmd = exec.Command("open", url)
	case "windows":
		cmd = exec.Command("rundll32", "url.dll,FileProtocolHandler", url)
	default:
		cmd = exec.Command("xdg-open", url)
	}
	return cmd.Start()
}
