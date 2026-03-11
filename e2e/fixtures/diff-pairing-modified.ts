import { alpha } from './alpha';
import { beta } from './beta';
import { gamma } from './gamma';

const helperC = () => {
  return 'c';
};

const helperB = () => {
  return 'b-modified';
};

const helperD = () => {
  return 'd';
};

const helperA = () => {
  return 'a';
};

const main = () => {
  helperA();
  helperB();
  helperC();
  helperD();
};

export { main };
