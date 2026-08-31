@echo off
title Custom VM Manager
powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "%~dp0VMManager.ps1"
