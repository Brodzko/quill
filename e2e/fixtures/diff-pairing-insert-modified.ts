import { alpha } from './alpha';
import { beta } from './beta';

const helperA = () => {
  return 'a';
};

const helperNew = () => {
  const x = calculate();
  return transform(x);
};

const helperB = () => {
  return 'b';
};

const main = () => {
  helperA();
  helperNew();
  helperB();
};

export { main };
