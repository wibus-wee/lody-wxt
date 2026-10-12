import process from 'node:process';

export default {
  paths: ['tests/e2e/features/**/*.feature'],
  import: ['tests/e2e/journey-steps/**/*.ts'],
  format: ['progress', 'json:reports/cucumber.json', 'html:reports/cucumber.html'],
  parallel: Number(process.env.ASSURANCE_WEB_WORKERS ?? 1),
};
