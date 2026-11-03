/**
 * Per-key promise queue. Guarantees that critical sections sharing the same key
 * (e.g. every bid on a single RFQ) run strictly one after another inside this
 * Node process, so ranking recalculation and soft-close extension never interleave.
 */
class KeyedMutex {
  constructor() {
    this.tails = new Map();
  }

  async run(key, task) {
    const previous = this.tails.get(key) || Promise.resolve();
    let release;
    const current = new Promise((resolve) => {
      release = resolve;
    });
    const tail = previous.then(() => current);
    this.tails.set(key, tail);

    await previous;
    try {
      return await task();
    } finally {
      release();
      if (this.tails.get(key) === tail) {
        this.tails.delete(key);
      }
    }
  }
}

module.exports = { KeyedMutex, auctionMutex: new KeyedMutex() };
