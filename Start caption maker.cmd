@echo off
rem Serves this folder on http://localhost:8765 and opens the caption maker.
rem (Needed for "Download PNG": browsers block saving when the page is opened as a file.)
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0serve.ps1"
