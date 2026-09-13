'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Pause, Play, Volume2, VolumeX } from 'lucide-react';
import { provenanceLabel, type PortfolioProvenance } from '@/lib/catalog/presentation';
import { categoryLabel } from '@/lib/catalog/categories';
import { cn } from '@/lib/utils';
import type { ShowcaseAspect } from '@/lib/catalog/showcase';
import type { ExperienceCategory } from '@/types/database';

/**
 * One player for every film on the site.
 *
 * Two things drive the design, and they pull in opposite directions: a film
 * should look like a film, and nobody should pay for a film they did not ask to
 * watch. The resolution is that NOTHING downloads on page load. Every instance
 * renders `preload="none"` with no `autoPlay` attribute, so the server-rendered
 * markup costs one poster image — about 70 KB — no matter how many players are
 * on the page. Bytes are spent when someone presses play, or when the one
 * flagship instance decides it may autoplay.
 *
 * `mode`:
 *   'on-demand' — the gallery. Native controls, sound available, nothing plays
 *                 until a person starts it.
 *   'autoplay'  — the flagship, and only ever one per page. Muted and looping,
 *                 and only once the checks below pass.
 *
 * Autoplay is a request, not a decision. It is withdrawn when:
 *   - the visitor asked for reduced motion (re-checked live, so changing the OS
 *     setting stops it without a reload);
 *   - the connection says Save-Data, or reports itself as 2g/slow-2g;
 *   - the browser refuses `play()`, which is its right and happens often.
 * In every one of those cases the player degrades to exactly the on-demand
 * player, poster and all — never to a blank frame.
 *
 * Controls are never removed, only replaced. While autoplaying, native controls
 * would put a progress bar across the most considered image on the site, so the
 * two that matter — pause and sound — are real <button>s in the tab order with
 * labels that track their state. Pausing hands back the native player, because
 * somebody who paused is now watching deliberately and wants a scrubber.
 *
 * Without JavaScript the markup is a plain <video controls poster> and works.
 */

const ASPECT_CLASS: Record<ShowcaseAspect, string> = {
  video: 'aspect-video',
  square: 'aspect-square',
  portrait: 'aspect-[4/5]',
};

export interface CinematicVideoProps {
  videoUrl: string;
  posterUrl: string;
  title: string;
  category: ExperienceCategory;
  /** Read out with the title; not shown here, since callers own their captions. */
  description?: string;
  provenance: PortfolioProvenance;
  aspect?: ShowcaseAspect;
  mode?: 'on-demand' | 'autoplay';
  /** Where the mark sits. The homepage strip is tighter than the gallery. */
  markSize?: 'sm' | 'md';
  className?: string;
}

export function CinematicVideo({
  videoUrl,
  posterUrl,
  title,
  category,
  description,
  provenance,
  aspect = 'video',
  mode = 'on-demand',
  markSize = 'md',
  className,
}: CinematicVideoProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [autoplaying, setAutoplaying] = useState(false);
  const [muted, setMuted] = useState(true);

  const mark = provenanceLabel(provenance);
  const accessibleName = description
    ? `${title} — ${categoryLabel(category)}. ${description}`
    : `${title} — ${categoryLabel(category)}`;

  useEffect(() => {
    if (mode !== 'autoplay') return;
    const video = videoRef.current;
    if (!video) return;

    const motion = window.matchMedia('(prefers-reduced-motion: reduce)');

    // Save-Data and the effective connection type are both optional; their
    // absence means "no reason to hold back", not "assume the worst".
    const connection = (
      navigator as Navigator & {
        connection?: { saveData?: boolean; effectiveType?: string };
      }
    ).connection;
    const constrained =
      connection?.saveData === true ||
      connection?.effectiveType === '2g' ||
      connection?.effectiveType === 'slow-2g';

    let cancelled = false;

    const start = () => {
      if (cancelled || motion.matches || constrained) return;
      video.muted = true;
      video.loop = true;
      video
        .play()
        .then(() => {
          if (!cancelled) setAutoplaying(true);
        })
        .catch(() => {
          // Refused. The native player is already underneath.
          if (!cancelled) setAutoplaying(false);
        });
    };

    const stop = () => {
      video.pause();
      setAutoplaying(false);
    };

    const onMotionChange = () => (motion.matches ? stop() : start());
    motion.addEventListener('change', onMotionChange);
    start();

    return () => {
      cancelled = true;
      motion.removeEventListener('change', onMotionChange);
    };
  }, [mode]);

  const pause = useCallback(() => {
    videoRef.current?.pause();
    // Hands back the native player: a deliberate viewer wants a scrubber.
    setAutoplaying(false);
  }, []);

  const toggleSound = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    video.muted = !video.muted;
    setMuted(video.muted);
  }, []);

  return (
    <div className={cn('media-frame', ASPECT_CLASS[aspect], className)}>
      <video
        ref={videoRef}
        className="size-full object-cover"
        poster={posterUrl}
        // Nothing is fetched until somebody asks for it, flagship included.
        preload="none"
        playsInline
        controls={!autoplaying}
        aria-label={accessibleName}
      >
        <source src={videoUrl} type="video/mp4" />
        {/* Reached only if the browser cannot play MP4 at all. */}
        <p className="p-6 text-sm text-bone-300">
          Your browser cannot play this film.{' '}
          <a href={videoUrl} className="underline">
            Download it instead
          </a>
          .
        </p>
      </video>

      {mark ? (
        <p
          className={cn(
            'pointer-events-none absolute rounded-full border border-bone-50/20 bg-ink-990/55 tracking-[0.2em] text-bone-200 uppercase backdrop-blur-sm',
            markSize === 'sm'
              ? 'top-3.5 left-3.5 px-2.5 py-0.5 text-[0.55rem]'
              : 'top-4 left-4 px-3 py-1 text-[0.6rem]',
          )}
        >
          {mark}
        </p>
      ) : null}

      {autoplaying ? (
        <div className="absolute right-4 bottom-4 flex gap-2">
          <ControlButton onClick={pause} label={`Pause ${title}`}>
            <Pause className="size-4" aria-hidden="true" />
          </ControlButton>
          <ControlButton
            onClick={toggleSound}
            label={muted ? `Turn on sound for ${title}` : `Mute ${title}`}
          >
            {muted ? (
              <VolumeX className="size-4" aria-hidden="true" />
            ) : (
              <Volume2 className="size-4" aria-hidden="true" />
            )}
          </ControlButton>
        </div>
      ) : null}
    </div>
  );
}

function ControlButton({
  onClick,
  label,
  children,
}: {
  onClick: () => void;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className="text-bone-100 inline-flex size-9 items-center justify-center rounded-full border border-bone-50/25 bg-ink-990/65 backdrop-blur-sm transition-colors hover:border-bone-50/50 hover:text-bone-50"
    >
      {children}
    </button>
  );
}

/**
 * The still, with a play affordance, for places that want the image and a link
 * rather than a player — the homepage strip, where the card is itself a link to
 * the gallery and nesting a player inside it would be both invalid markup and a
 * confusing target.
 */
export function CinematicStill({
  posterUrl,
  title,
  provenance,
  aspect = 'video',
  className,
  imageClassName,
}: {
  posterUrl: string;
  title: string;
  provenance: PortfolioProvenance;
  aspect?: ShowcaseAspect;
  className?: string;
  imageClassName?: string;
}) {
  const mark = provenanceLabel(provenance);

  return (
    <div className={cn('media-frame', ASPECT_CLASS[aspect], className)}>
      {/* Not next/image: these are static assets at a known size, and the
          optimiser would add a request and a cache entry for no gain. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={posterUrl}
        alt={title}
        width={1280}
        height={720}
        loading="lazy"
        decoding="async"
        className={cn('size-full object-cover', imageClassName)}
      />

      <span
        aria-hidden="true"
        className="absolute inset-0 flex items-center justify-center opacity-0 transition-opacity duration-500 group-focus-within:opacity-100 group-hover:opacity-100 motion-reduce:transition-none"
      >
        <span className="inline-flex size-12 items-center justify-center rounded-full border border-bone-50/30 bg-ink-990/55 backdrop-blur-sm">
          <Play className="size-4 text-bone-50" />
        </span>
      </span>

      {mark ? (
        <p className="absolute top-3.5 left-3.5 rounded-full border border-bone-50/20 bg-ink-990/55 px-2.5 py-0.5 text-[0.55rem] tracking-[0.2em] text-bone-200 uppercase backdrop-blur-sm">
          {mark}
        </p>
      ) : null}
    </div>
  );
}
