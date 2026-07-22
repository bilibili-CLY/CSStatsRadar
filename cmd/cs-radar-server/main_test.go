package main

import "testing"

func TestStartupURL(t *testing.T) {
	tests := []struct {
		name string
		addr string
		want string
	}{
		{
			name: "loopback",
			addr: "127.0.0.1:8000",
			want: "http://127.0.0.1:8000/",
		},
		{
			name: "wildcard ipv4",
			addr: "0.0.0.0:8000",
			want: "http://127.0.0.1:8000/",
		},
		{
			name: "wildcard ipv6",
			addr: "[::]:8000",
			want: "http://127.0.0.1:8000/",
		},
		{
			name: "ipv6 loopback",
			addr: "[::1]:8000",
			want: "http://[::1]:8000/",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := startupURL(tt.addr); got != tt.want {
				t.Fatalf("startupURL(%q) = %q, want %q", tt.addr, got, tt.want)
			}
		})
	}
}
