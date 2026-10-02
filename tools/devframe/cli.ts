import { createCac } from 'devframe/adapters/cac';

import definition from './definition';

await createCac(definition).parse();
