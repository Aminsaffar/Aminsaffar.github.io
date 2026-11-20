export const EXAMPLES = [
  {
    id: 'starter',
    title: 'Interactive greeting',
    level: 'Beginner',
    code: `name = input("What is your name? ")\nprint(f"Hello, {name}!")\n\nnumber = int(input("Enter a number: "))\nprint(f"Your number multiplied by 2 is {number * 2}")\n`,
  },
  {
    id: 'loops',
    title: 'Count with a loop',
    level: 'Beginner',
    code: `for number in range(1, 11):\n    print(f"{number:02}  {'●' * number}")\n`,
  },
  {
    id: 'choices',
    title: 'Choose a path',
    level: 'Beginner',
    code: `choice = input("Pick a color (teal, blue, or amber): ").strip().lower()\ncolors = {"teal": "ocean", "blue": "sky", "amber": "sunlight"}\n\nif choice in colors:\n    print(f"{choice.title()} feels like {colors[choice]}.")\nelse:\n    print("Try teal, blue, or amber next time.")\n`,
  },
  {
    id: 'exceptions',
    title: 'Safe division',
    level: 'Beginner',
    code: `try:\n    number = float(input("Enter a number to divide 100 by: "))\n    print("Result:", 100 / number)\nexcept ValueError:\n    print("That was not a number.")\nexcept ZeroDivisionError:\n    print("Zero cannot be used as a divisor.")\n`,
  },
  {
    id: 'unicode',
    title: 'Persian greeting',
    level: 'Beginner',
    code: `name = input("نام خود را وارد کنید: ")\nprint("سلام", name)\n`,
  },
  {
    id: 'exercise',
    title: 'Exercise · add two numbers',
    level: 'Practice',
    code: `# Ask for two whole numbers, then print their sum.\n# Hint: input() returns text, so convert each value with int().\n\nfirst = int(input("Enter the first number: "))\nsecond = int(input("Enter the second number: "))\nprint("Your total is:", first + second)\n`,
  },
  {
    id: 'stop',
    title: 'Stop a long-running program',
    level: 'Practice',
    code: `# Try Run, then click Stop. The Worker should be restarted.\nwhile True:\n    pass\n`,
  },
];
