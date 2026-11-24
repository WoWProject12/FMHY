    const handlePlaybackTime = useCallback((timeSec: number) => {
        // Ignore cold-start 0/near-0 ticks while a remount is seeking back
        // to the previous position (manual source switches).
        if (
            Number.isFinite(timeSec) &&
            timeSec < 0.5 &&
            livePlaybackTimeRef.current >= 0.5
        ) {
            return
        }
        if (Number.isFinite(timeSec) && timeSec >= 0) {
            livePlaybackTimeRef.current = timeSec
            // Lock the session once real playback is underway so a late
            // higher-ranked provider (e.g. VAPlayer after VSEmbed) cannot
            // remount mid-watch and flash the source probe list.
            if (timeSec >= 2 && !playbackStableRef.current) {
                playbackStableRef.current = true
                setPlaybackStable(true)
                setPlaybackActive(true)
            }
        }
    }, [])