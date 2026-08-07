import urllib.request
import re
import json

pin_url = "https://it.pinterest.com/pin/717831628150450077/"
req = urllib.request.Request(
    pin_url,
    headers={
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    }
)

try:
    html = urllib.request.urlopen(req).read().decode('utf-8', errors='ignore')
    # Search for video urls or mp4
    mp4_matches = re.findall(r'https?://[^\s\"\'<>]+\.mp4', html)
    v1_matches = re.findall(r'https?://v1\.pinimg\.com[^\s\"\'<>]+', html)
    gif_matches = re.findall(r'https?://[^\s\"\'<>]+\.gif', html)
    print("MP4 matches:", mp4_matches)
    print("V1 matches:", v1_matches)
    print("GIF matches:", gif_matches)
except Exception as e:
    print("Error:", e)
