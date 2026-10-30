- **Recall stops throwing away finished answers.** About one turn in twenty showed no memories because
  recall had passed its time limit, even though the answer was already done and showing it cost about
  5 ms. Those turns now show it, and the record says how late they ran.
- **Recall is faster on a large store, with the same results.** On about 5,000 memories, recall itself
  went from about 415 ms to about 110 ms when the store hasn't been read for a minute or so, and the
  whole step before your message is sent from about 725 ms to about 400 ms. The first background run
  after updating builds an index for this, about half a second, and the cache file grows by about 15 MB.
