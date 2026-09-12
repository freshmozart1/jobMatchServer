// The deep imports below are deliberate. cover-letter-generator doesn't export
// its generation model or reasoning effort from its index, and a copied value
// would silently drift from the pinned version, which is exactly the drift this
// check exists to catch. tsc type-checks both paths, so an upstream rename or
// move breaks `npm run build` in the bump PR itself: the intended loud signal.
// freshmozart1/cover-letter-generator#51 tracks a public export that doesn't
// construct an OpenAI client; once it ships, it retires these deep imports.
//
// Never import the package root here: its dist/llm.js runs `new OpenAI()` at
// import time and throws without OPENAI_API_KEY, turning the no-key skip into a
// crash.
import { GENERATOR_MODEL } from 'cover-letter-generator/dist/constants/generatorModel.js';
import { GENERATOR_REASONING_EFFORT } from 'cover-letter-generator/dist/constants/generatorReasoningEffort.js';
import { OpenAI } from 'openai';
import {
    formatOutcome,
    runGeneratorModelSmokeCheck,
} from './runGeneratorModelSmokeCheck.js';

const outcome = await runGeneratorModelSmokeCheck({
    apiKey: process.env['OPENAI_API_KEY'],
    model: GENERATOR_MODEL,
    reasoningEffort: GENERATOR_REASONING_EFFORT,
    skipOnUnauthorized:
        process.env['SMOKE_CHECK_SKIP_ON_UNAUTHORIZED'] === 'true',
    createResponse: (apiKey, request) => {
        const client = new OpenAI({ apiKey, timeout: 120_000 });
        return client.responses.create(request);
    },
});

const line = formatOutcome(outcome, process.env['GITHUB_ACTIONS'] === 'true');
if (outcome.status === 'failed') {
    console.error(line);
    process.exitCode = 1;
} else {
    console.log(line);
}
