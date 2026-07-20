import asyncio
import websockets
import json
import wave
import io
import sys

def generate_silent_wav() -> bytes:
    wav_io = io.BytesIO()
    with wave.open(wav_io, 'wb') as wav_file:
        wav_file.setnchannels(1)
        wav_file.setsampwidth(2)  # 16-bit
        wav_file.setframerate(16000)  # 16kHz
        # 16000 frames of silence (2 bytes per frame)
        wav_file.writeframes(b'\x00' * 32000)
    return wav_io.getvalue()

async def run_test():
    # Inside the docker network, we can connect to localhost:5002
    url = "ws://localhost:5002/api/v1/ws"
    print(f"Connecting to {url}...")
    try:
        async with websockets.connect(url) as ws:
            print("Connected. Sending start event...")
            start_event = {
                "type": "start",
                "token": "mock-tech",
                "sessionId": None
            }
            await ws.send(json.dumps(start_event))

            # Read ready response
            resp = await ws.recv()
            print(f"Received start response: {resp}")

            print("Sending audio bytes...")
            audio_bytes = generate_silent_wav()
            await ws.send(audio_bytes)

            print("Sending stop event...")
            stop_event = {
                "type": "stop"
            }
            await ws.send(json.dumps(stop_event))

            print("Monitoring response flow...")
            while True:
                try:
                    msg = await asyncio.wait_for(ws.recv(), timeout=35.0)
                    if isinstance(msg, bytes):
                        print(f"Received binary chunk of size: {len(msg)}")
                    else:
                        data = json.loads(msg)
                        print(f"Received JSON event: {data}")
                        if data.get("type") == "status" and data.get("status") == "ready":
                            print("Server completed response stream successfully.")
                            break
                        if data.get("type") == "error":
                            print(f"Server sent error: {data.get('message')}")
                            sys.exit(1)
                except asyncio.TimeoutError:
                    print("Timeout waiting for response.")
                    break
    except Exception as e:
        print(f"Error during websocket test: {e}")
        sys.exit(1)

if __name__ == "__main__":
    asyncio.run(run_test())
