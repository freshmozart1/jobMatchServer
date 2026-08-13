// cover-letter-generator constructs an OpenAI client at import time (see its
// dist/llm.js), so merely importing it — even for types/constants — throws
// without OPENAI_API_KEY set. None of the mocked test suites in this repo
// call the real OpenAI API, so a placeholder key unblocks local test runs
// the same way cover-letter-generator's own test script does.
process.env.OPENAI_API_KEY ??= 'test-key';
