package radar

import (
	"encoding/binary"
	"testing"
)

func TestMP4DurationMS(t *testing.T) {
	mvhd := make([]byte, 20)
	binary.BigEndian.PutUint32(mvhd[12:16], 1000)
	binary.BigEndian.PutUint32(mvhd[16:20], 2_658_560)
	mvhdBox := make([]byte, 8+len(mvhd))
	binary.BigEndian.PutUint32(mvhdBox[:4], uint32(len(mvhdBox)))
	copy(mvhdBox[4:8], "mvhd")
	copy(mvhdBox[8:], mvhd)
	moov := make([]byte, 8+len(mvhdBox))
	binary.BigEndian.PutUint32(moov[:4], uint32(len(moov)))
	copy(moov[4:8], "moov")
	copy(moov[8:], mvhdBox)
	if got := mp4DurationMS(moov); got != 2_658_560 {
		t.Fatalf("duration = %d", got)
	}
}
