#!/bin/bash
export SEVENMOVIES_BOOT_PORT=3887
export SEVENMOVIES_FETCH_CONCURRENCY=6
export WARP_SOCKS=socks5h://127.0.0.1:40000
export SEVENMOVIES_SOCKS=socks5h://127.0.0.1:40000
exec /opt/curl-cffi-venv/bin/python3 /var/www/cinepro/scripts/sevenmovies-boot.py
