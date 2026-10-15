' Run a console program without showing a window (used by CTC push scheduled tasks).
' Usage: wscript //B //Nologo run-hidden.vbs <program.exe> [args...]
' Waits for the program and returns its exit code, so Task Scheduler shows success / failure correctly.
Set sh = CreateObject("WScript.Shell")
cmd = ""
For i = 0 To WScript.Arguments.Count - 1
  cmd = cmd & " """ & WScript.Arguments(i) & """"
Next
WScript.Quit sh.Run(Trim(cmd), 0, True)
