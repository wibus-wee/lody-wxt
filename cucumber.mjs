export default {
  paths: ['tests/e2e/features/**/*.feature'],
  import: ['tests/e2e/journey-steps/**/*.ts'],
  format: ['progress', 'json:reports/cucumber.json', 'html:reports/cucumber.html'],
  parallel: 1,
};
