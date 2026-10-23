export const learningPaths = [
  {
    id: 'clear-communication',
    title: 'Communicate with clarity',
    category: 'Communication',
    description: 'Make your thinking easier to understand in writing, meetings, and everyday conversations.',
    lessons: [
      {
        id: 'one-clear-point',
        title: 'Lead with one clear point',
        duration: '8 min',
        content: 'Clarity starts by deciding what the other person should remember. Put that point first, then add only the context needed to understand it.',
        exercise: 'Write a three-sentence update: the main point, one supporting detail, and the next action.'
      },
      {
        id: 'structure-a-story',
        title: 'Structure a useful story',
        duration: '12 min',
        content: 'A short situation–choice–outcome structure helps people follow why your decision mattered without losing the detail.',
        exercise: 'Describe a recent decision in three lines: what was happening, what you chose, and what changed.'
      },
      {
        id: 'ask-better-questions',
        title: 'Ask questions that open work',
        duration: '10 min',
        content: 'Open questions surface intent and constraints. Follow a broad question with one focused question to turn discussion into a practical next step.',
        exercise: 'Before your next conversation, write one question about the outcome and one about the biggest constraint.'
      }
    ]
  },
  {
    id: 'focused-work',
    title: 'Build a focus practice',
    category: 'Personal effectiveness',
    description: 'Create repeatable conditions for focused work without expecting every day to be perfect.',
    lessons: [
      {
        id: 'choose-one-outcome',
        title: 'Choose one outcome',
        duration: '7 min',
        content: 'A useful focus block has a visible finish line. Define the smallest meaningful result before deciding how long to work.',
        exercise: 'Turn one vague task into a deliverable you can point to at the end of a 25-minute block.'
      },
      {
        id: 'reduce-friction',
        title: 'Reduce start-up friction',
        duration: '9 min',
        content: 'Preparation makes starting easier: open the right materials, write the first action, and remove one likely interruption.',
        exercise: 'Prepare a two-minute start ritual for your next focus block and try it once.'
      },
      {
        id: 'review-and-adjust',
        title: 'Review without judgement',
        duration: '10 min',
        content: 'A short review distinguishes what helped from what got in the way. Adjust the environment or task size instead of blaming yourself.',
        exercise: 'After a work block, note one thing that helped, one obstacle, and one small change for next time.'
      }
    ]
  },
  {
    id: 'career-direction',
    title: 'Find your career direction',
    category: 'Career',
    description: 'Connect your strengths and interests to small experiments that reveal what you want next.',
    lessons: [
      {
        id: 'energy-audit',
        title: 'Notice your energy',
        duration: '10 min',
        content: 'Patterns in energy can reveal which tasks, environments, and collaborations are worth seeking more often.',
        exercise: 'List three work moments from the past month that felt engaging and what each had in common.'
      },
      {
        id: 'strength-evidence',
        title: 'Collect evidence of strengths',
        duration: '12 min',
        content: 'Useful strengths are observable. Look for repeated situations where your contribution made work clearer, faster, or more useful.',
        exercise: 'Write down one piece of feedback and one concrete result that show a strength you use.'
      },
      {
        id: 'run-a-small-experiment',
        title: 'Run a small career experiment',
        duration: '12 min',
        content: 'A low-risk experiment provides better information than waiting for certainty. Choose a short action that exposes you to the work.',
        exercise: 'Choose one conversation, project, or practice task that tests an appealing direction this month.'
      }
    ]
  }
]

const knownLessonKeys = new Set(
  learningPaths.flatMap((path) => path.lessons.map((lesson) => `${path.id}:${lesson.id}`))
)

export const isKnownLesson = (pathId, lessonId) => knownLessonKeys.has(`${pathId}:${lessonId}`)

