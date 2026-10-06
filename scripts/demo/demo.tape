# The README demo: a real terminal, a real shell, the real published `npx vexryn`.
# Typed with a human rhythm (uneven speed, pauses, one typo fixed). First run of a new
# user: npx asks to install, gets a "y", downloads for real — the loading time is real.
# Record from the repo root:  vhs scripts/demo/demo.tape   → assets/scan.gif

Output assets/scan.gif

Require npx
Set Shell "bash"
Set FontFamily "Menlo"
Set FontSize 14
Set LineHeight 1.1
Set Width 1240
Set Height 1110
Set Padding 26
Set Margin 0
Set WindowBar Colorful
Set BorderRadius 10
Set Framerate 24
Set TypingSpeed 85ms
Set CursorBlink true
Set WaitPattern /❯/
Set WaitTimeout 40s
Set Theme { "name": "Vexryn", "background": "#0A0E27", "foreground": "#EEF1FA", "cursor": "#4A90FF", "selection": "#141A33", "black": "#0A0E27", "red": "#FF5A4E", "green": "#37C98B", "yellow": "#E6B23C", "blue": "#4A90FF", "magenta": "#C46BFF", "cyan": "#4A90FF", "white": "#8B93AC", "brightBlack": "#565E7E", "brightRed": "#FF5A4E", "brightGreen": "#37C98B", "brightYellow": "#E6B23C", "brightBlue": "#4A90FF", "brightMagenta": "#C46BFF", "brightCyan": "#4A90FF", "brightWhite": "#EEF1FA" }

# --- off camera: the throwaway demo world (outside $HOME), warm npx cache
Hide
Type "source scripts/demo/setup.sh && clear"
Enter
Wait
Show

# --- scene 1: a repo with a few agent configs → the logo, the verdict, the report
Sleep 1.2s
Type@95ms "npx "
Sleep 180ms
Type@130ms "vex"
Type@70ms "ryn"
Sleep 140ms
Type@85ms " scan"
Sleep 700ms
Enter
# first run: npx asks before installing — read it, answer y, then npm really downloads
Wait+Screen@60s /Ok to proceed/
Sleep 1.3s
Type@150ms "y"
Sleep 350ms
Enter
Wait
Sleep 6.5s

# --- scene 2: another project, measured live → the spinner, what tools can do
# (`-y` this time: npx asked once already; it answers yes up front)
Ctrl+L
Sleep 900ms
Type@90ms "cd ../ag"
Type@60ms "ne"
Sleep 350ms
Backspace 2
Sleep 200ms
Type@100ms "ents-lab"
Sleep 300ms
Enter
Sleep 700ms
Type@80ms "npx -y vexryn scan"
Sleep 250ms
Type@140ms " --deep"
Sleep 650ms
Enter
Wait
Sleep 7s
