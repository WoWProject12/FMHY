        const existing = pickForRequest(playbackOptions)
        // Embed fast-start often never marks health "ready". Still switch
        // immediately when that provider already has a stream — except for
        // client-resolve providers (VAPlayer/Movy/Videasy/…). Their URLs expire
        // and reusing a cached option remounted a dead stream (black until the
        // user tapped the same source again). Always re-scrape those.
        //
        // VSEmbed (and other on-demand TV scrapes) must also re-fetch: after
        // episode changes, a leftover "ready" VSEmbed row can still point at
        // the previous episode (S4E7 playing while UI says S4E6).
        const mustRefetchProvider =
            isClientResolveProvider(providerKey) ||
            providerKey === "vsembed" ||
            (mediaType === "tv" &&
                (providerKey === "hollymoviehd" ||
                    providerKey === "moviesonlinehd" ||
                    providerKey === "cinejoy" ||
                    providerKey === "vidapiru"))
        if (
            existing &&
            !mustRefetchProvider &&
            (toflixPlayback ||
                canImmediatelyStartProviderOption(existing, sourceHealth))
        ) {
            handleSelectSource(existing.id, existing)
            return
        }