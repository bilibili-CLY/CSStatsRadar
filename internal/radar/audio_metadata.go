package radar

import (
	"encoding/binary"
	"os"
	"path/filepath"
	"strings"
)

func showcaseMusicInfo(path string) (ShowcaseMusicInfo, error) {
	url, err := fileDataURL(path)
	if err != nil {
		return ShowcaseMusicInfo{}, err
	}
	return ShowcaseMusicInfo{URL: url, DurationMS: audioDurationMS(path)}, nil
}

func audioDurationMS(path string) int {
	data, err := os.ReadFile(path)
	if err != nil {
		return 0
	}
	switch strings.ToLower(filepath.Ext(path)) {
	case ".m4a", ".mp4", ".mov":
		return mp4DurationMS(data)
	case ".wav":
		return wavDurationMS(data)
	default:
		return 0
	}
}

func mp4DurationMS(data []byte) int {
	mvhd := findMP4Box(data, "mvhd")
	if len(mvhd) < 20 {
		return 0
	}
	var timescale uint32
	var duration uint64
	if mvhd[0] == 1 {
		if len(mvhd) < 32 {
			return 0
		}
		timescale = binary.BigEndian.Uint32(mvhd[20:24])
		duration = binary.BigEndian.Uint64(mvhd[24:32])
	} else {
		timescale = binary.BigEndian.Uint32(mvhd[12:16])
		duration = uint64(binary.BigEndian.Uint32(mvhd[16:20]))
	}
	if timescale == 0 {
		return 0
	}
	return int((duration*1000 + uint64(timescale)/2) / uint64(timescale))
}

func findMP4Box(data []byte, target string) []byte {
	for offset := 0; offset+8 <= len(data); {
		size := uint64(binary.BigEndian.Uint32(data[offset : offset+4]))
		header := 8
		if size == 1 {
			if offset+16 > len(data) {
				return nil
			}
			size = binary.BigEndian.Uint64(data[offset+8 : offset+16])
			header = 16
		} else if size == 0 {
			size = uint64(len(data) - offset)
		}
		if size < uint64(header) || size > uint64(len(data)-offset) {
			return nil
		}
		kind := string(data[offset+4 : offset+8])
		payload := data[offset+header : offset+int(size)]
		if kind == target {
			return payload
		}
		if kind == "moov" {
			if found := findMP4Box(payload, target); found != nil {
				return found
			}
		}
		offset += int(size)
	}
	return nil
}

func wavDurationMS(data []byte) int {
	if len(data) < 12 || string(data[:4]) != "RIFF" || string(data[8:12]) != "WAVE" {
		return 0
	}
	var bytesPerSecond uint32
	var audioBytes uint32
	for offset := 12; offset+8 <= len(data); {
		kind := string(data[offset : offset+4])
		size := int(binary.LittleEndian.Uint32(data[offset+4 : offset+8]))
		start := offset + 8
		end := start + size
		if end > len(data) {
			break
		}
		if kind == "fmt " && size >= 12 {
			bytesPerSecond = binary.LittleEndian.Uint32(data[start+8 : start+12])
		}
		if kind == "data" {
			audioBytes = uint32(size)
		}
		offset = end + size%2
	}
	if bytesPerSecond == 0 {
		return 0
	}
	return int((uint64(audioBytes)*1000 + uint64(bytesPerSecond)/2) / uint64(bytesPerSecond))
}
