        const incomingEmpty = incomingSources.length === 0
        const hadPlayable = previous.length > 0
        const terminalEmpty = nextDiagnostics.some((item) =>
          TERMINAL_SOURCE_DIAGNOSTIC_CODES.has(item.code ?? "")
        )
        const backgroundPending = isBackgroundSourcesPending(nextDiagnostics)
        // Never retain another episode/title's streams — that made VSEmbed play
        // S4E7 while the UI/URL already said S4E6 after Back.
        const previousBelongsToCurrentParams =
          !resolvedParamsKey || resolvedParamsKey === cacheKey
        if (
          incomingEmpty &&
          hadPlayable &&
          previousBelongsToCurrentParams &&
          !options?.provider &&
          (backgroundPending || !terminalEmpty)
        ) {
          keptPreviousSources = true
          resolvedSources = previous
          return previous
        }