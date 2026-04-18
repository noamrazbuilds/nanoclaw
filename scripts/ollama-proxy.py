#!/usr/bin/env python3
"""TCP proxy: 0.0.0.0:11435 → 127.0.0.1:11434
Exposes localhost-bound Ollama to Docker containers."""

import asyncio
import signal
import sys

LISTEN_HOST = "0.0.0.0"
LISTEN_PORT = 11435
TARGET_HOST = "127.0.0.1"
TARGET_PORT = 11434


async def pipe(reader: asyncio.StreamReader, writer: asyncio.StreamWriter):
    try:
        while True:
            data = await reader.read(65536)
            if not data:
                break
            writer.write(data)
            await writer.drain()
    except (ConnectionResetError, BrokenPipeError):
        pass
    finally:
        writer.close()


async def handle_client(
    client_reader: asyncio.StreamReader, client_writer: asyncio.StreamWriter
):
    try:
        target_reader, target_writer = await asyncio.open_connection(
            TARGET_HOST, TARGET_PORT
        )
    except OSError:
        client_writer.close()
        return

    await asyncio.gather(
        pipe(client_reader, target_writer),
        pipe(target_reader, client_writer),
    )


async def main():
    server = await asyncio.start_server(handle_client, LISTEN_HOST, LISTEN_PORT)
    print(
        f"Ollama proxy: {LISTEN_HOST}:{LISTEN_PORT} → {TARGET_HOST}:{TARGET_PORT}",
        flush=True,
    )

    loop = asyncio.get_event_loop()
    for sig in (signal.SIGTERM, signal.SIGINT):
        loop.add_signal_handler(sig, server.close)

    async with server:
        await server.serve_forever()


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        sys.exit(0)
