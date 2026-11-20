# TODO

## Browser-only architecture and static delivery
- [x] Build the application using HTML5, CSS3, JavaScript (Vanilla JS or modular architecture), Pyodide (CPython compiled to WebAssembly), Web Workers for Python execution, Monaco Editor or CodeMirror 6 for code editing, and IndexedDB or LocalStorage for persistent projects.
- [x] Python code must execute entirely on the client side using Pyodide and WebAssembly.
- [x] Do not use Python execution APIs, backend execution servers, Node.js execution servers, Docker containers, or remote code execution services.
- [x] The application must work as a static website and be deployable on GitHub Pages, Cloudflare Pages, or any static hosting provider.

## IDE shell, navigation, and visual design
- [x] Create a professional, responsive IDE interface inspired by VS Code, with a top navigation bar, application logo and name, Run button, Stop button, Restart Python runtime button, Save project button, Download Python file button, and Dark / Light theme switcher.
- [x] The design should use modern typography, professional spacing, subtle borders, rounded panels, clear visual hierarchy, smooth transitions, and minimal unnecessary decorations. It must not look like a basic HTML textarea.
- [x] Dark theme is the default.

## Python editor
- [x] Provide a professional Python editor with Python syntax highlighting, line numbers, automatic indentation, code completion where supported, bracket matching, code folding, find and replace, multiple tabs, keyboard shortcuts, editable code area, and Python language support.
- [x] Default starter code:
  ```python
  name = input("What is your name? ")
  print(f"Hello, {name}!")

  number = int(input("Enter a number: "))
  print(f"Your number multiplied by 2 is {number * 2}")
  ```

## Interactive terminal and stdin/stdout
- [x] Implement a real interactive terminal interface supporting standard output (stdout), standard error (stderr), interactive input (stdin), Python `input()`, multiple consecutive `input()` calls, Unicode and Persian text, multiline output, ANSI colors where feasible, terminal clearing, command history for terminal input, and auto-scrolling to the latest output.
- [x] Do not implement `input()` using JavaScript `prompt()`.
- [x] Use asynchronous communication between the Python Web Worker and browser terminal. When Python calls `input()`, Pyodide execution pauses; the Worker sends an input-request message to the main thread; the terminal displays the input prompt; the user types a response; Enter sends the response back to the Worker; Python execution resumes with the supplied input; and this repeats for subsequent `input()` calls.
- [x] Use a reliable stdin/stdout communication architecture. Keep terminal input editable while Python is waiting for input.
- [x] Expected behavior for consecutive input calls:
  ```python
  name = input("Enter your name: ")
  age = int(input("Enter your age: "))

  print("Hello", name)
  print("You are", age, "years old")
  ```
  produces prompts that accept the responses, then prints the greeting and age.

## Pyodide runtime and Worker lifecycle
- [x] Use the actual Pyodide Python runtime. Load it asynchronously and display runtime initialization progress; initialize the runtime only once; execute code inside a dedicated Web Worker; capture stdout and stderr; support Python standard-library modules available in Pyodide; support installing compatible packages using `micropip`; handle Python exceptions and display tracebacks; support execution cancellation; and recover gracefully from runtime errors.
- [x] Do not block the browser's main UI thread.

## Project and file management
- [x] Implement a lightweight project management system: create new Python files; rename files; delete files; save code automatically; restore previous work after refreshing the browser; store projects using IndexedDB; download individual `.py` files; import existing `.py` files; and create and switch between multiple projects.

## Terminal controls and status
- [x] Provide terminal controls to clear the terminal, copy output, download terminal output, show execution duration, display execution status (Running / Waiting for Input / Completed / Error), and visually distinguish normal output, errors, and user input.

## Responsive desktop, tablet, and mobile layouts
- [x] Support desktop computers, tablets, and mobile devices.
- [x] On desktop, display editor and terminal side by side or vertically resizable, and allow users to resize panels.
- [x] On mobile, provide tabs for Editor and Terminal, keep the Run button accessible, and ensure terminal input works with the mobile keyboard.

## Security, reliability, and recovery
- [x] Execute Python in a dedicated Web Worker. Never execute arbitrary JavaScript received from Python using `eval()`.
- [x] Provide a mechanism to terminate and recreate the Worker. Explain that browser-based execution is not a complete security sandbox.
- [x] Add execution time limits and memory safeguards where technically possible. Prevent accidental UI freezing. Handle worker crashes and runtime initialization failures.

## Educational support and examples
- [x] Design the platform for programming students with a beginner-friendly interface, helpful Python error messages, example programs, a welcome screen with sample code, keyboard shortcuts, a simple documentation/help section, and optional sample exercises.

## Required program behavior
- [x] Test basic output with `print("Hello World!")`.
- [x] Test interactive input with `name = input("Name: ")` followed by `print("Hello", name)`.
- [x] Test multiple inputs with two integer prompts and `print("Result:", a + b)`.
- [x] Test loops with `for i in range(10): print(i)`.
- [x] Test exceptions with input conversion and handlers for `ValueError` and `ZeroDivisionError`.
- [x] Test Unicode with a Persian input prompt `نام خود را وارد کنید: ` and output `سلام` plus the response.
- [x] Test an infinite loop (`while True: pass`) and ensure it cannot permanently freeze the application; the user must be able to stop execution by terminating and recreating the Worker.

## Complete source, local use, and deployment instructions
- [x] Provide complete working source code and all required HTML, CSS, and JavaScript files, a functional Pyodide Web Worker, a working interactive terminal with stdin support, an IndexedDB project manager, and responsive desktop and mobile layouts.
- [x] Provide instructions for local development and deployment on Cloudflare Pages and GitHub Pages.
- [x] Do not provide pseudocode or incomplete placeholders. Implement and test the complete application.
- [x] Acceptance criterion: a student can open the website, write arbitrary Python code, click Run, interact with `input()` through the integrated terminal, and see actual execution results without installing Python and without communicating with any execution backend.
