\# ONYX Build Notes



\## Baseline

This repo is based on a working local fork of Void.



\## Windows working setup

\- Node: 20.18.2

\- Visual Studio toolchain initialized with vcvars64.bat

\- VS 2026 compatibility workaround:

&#x20; - set vs2022\_install=C:\\Program Files\\Microsoft Visual Studio\\18\\Community



\## Required manual fixes discovered

\- React sub-build:

&#x20; - run `node build.js` in:

&#x20;   `src\\vs\\workbench\\contrib\\void\\browser\\react`

\- node-pty terminal fix:

&#x20; - ensure `conpty.dll` exists at:

&#x20;   `node\_modules\\node-pty\\build\\Release\\conpty\\conpty.dll`

&#x20; - source DLL found under:

&#x20;   `node\_modules\\node-pty\\third\_party\\conpty\\1.22.250204002\\win10-x64\\conpty.dll`



\## Launch

\- from repo root:

&#x20; - `.\\scripts\\code.bat`

