import { listenWithFallback } from './server/listen.js';
import { killTokenServiceProcess } from './tokenService/startTokenService.js';

const START_PORT = 3000;

console.log(
    'MongoDB connection string:',
    process.env['MONGODB_CONNECTION_STRING'],
);

void listenWithFallback(START_PORT).catch((error: unknown) => {
    console.error(error);
    killTokenServiceProcess();
    process.exit(1);
});
