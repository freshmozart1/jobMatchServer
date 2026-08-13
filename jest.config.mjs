export default {
  testEnvironment: 'node',
  testMatch: ['<rootDir>/dist/**/*.test.js'],
  testPathIgnorePatterns: ['<rootDir>/dist/test*'],
  setupFiles: ['<rootDir>/jest.setup.mjs'],
};
