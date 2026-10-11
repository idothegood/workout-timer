@echo off
rem Rebuilds "Workout Timer.exe" one folder up. Needs: pip install pywebview pyinstaller pillow
cd /d "%~dp0"
python make_icon.py
python -m PyInstaller --noconfirm --onefile --windowed --name "Workout Timer" --icon "%~dp0icon.ico" --add-data "%~dp0ui.html;." --add-data "%~dp0icon.ico;." --add-data "%~dp0icon-256.png;." --distpath .. --workpath "%TEMP%\wt-build" --specpath "%TEMP%\wt-build" app.py
