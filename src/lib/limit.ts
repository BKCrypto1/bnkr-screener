/**
 * Bounded-concurrency queue. Wrap async work with the returned `limit`
 * function to cap how many run in parallel.
 *
 *   const limit = createLimit(3);
 *   await Promise.all(items.map((it) => limit(() => doWork(it))));
 */
export function createLimit(concurrency: number) {
  let active = 0;
  const queue: Array<() => void> = [];

  function pump() {
    while (active < concurrency && queue.length > 0) {
      const run = queue.shift()!;
      active++;
      run();
    }
  }

  return function limit<T>(fn: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const run = () => {
        fn()
          .then(resolve, reject)
          .finally(() => {
            active--;
            pump();
          });
      };
      queue.push(run);
      pump();
    });
  };
}
