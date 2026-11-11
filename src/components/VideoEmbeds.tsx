import { ExternalLink, PlayCircle } from 'lucide-react';
import type { RecipeVideo } from '../types/recipe';
import { withBase } from '../utils/paths';

export interface VideoEmbedsProps {
  videos: RecipeVideo[];
}

function getYouTubeEmbedUrl(video: RecipeVideo): {
  src: string;
  isShort: boolean;
} {
  const candidates = [video.embedUrl, video.url];
  const isShort = candidates.some((candidate) =>
    candidate.includes('/shorts/')
  );

  for (const raw of candidates) {
    try {
      const parsed = new URL(raw);
      const host = parsed.hostname.replace(/^www\./, '');

      if (host === 'youtu.be') {
        const id = parsed.pathname.split('/').filter(Boolean)[0];
        if (id) {
          return {
            src: `https://www.youtube-nocookie.com/embed/${id}?rel=0`,
            isShort,
          };
        }
      }

      if (
        host === 'youtube.com' ||
        host === 'm.youtube.com' ||
        host === 'youtube-nocookie.com'
      ) {
        const vParam = parsed.searchParams.get('v');
        if (vParam) {
          return {
            src: `https://www.youtube-nocookie.com/embed/${vParam}?rel=0`,
            isShort,
          };
        }

        const segments = parsed.pathname.split('/').filter(Boolean);
        if (
          segments.length >= 2 &&
          (segments[0] === 'embed' ||
            segments[0] === 'shorts' ||
            segments[0] === 'live')
        ) {
          return {
            src: `https://www.youtube-nocookie.com/embed/${segments[1]}?rel=0`,
            isShort: segments[0] === 'shorts' || isShort,
          };
        }
      }
    } catch {
      // Continue to next candidate
    }
  }

  return { src: video.embedUrl, isShort };
}

function getInstagramEmbedUrl(video: RecipeVideo): string {
  for (const raw of [video.embedUrl, video.url]) {
    const match = raw.match(/instagram\.com\/(p|reel|tv)\/([^/?#]+)/i);
    if (match) {
      return `https://www.instagram.com/${match[1].toLowerCase()}/${match[2]}/embed`;
    }
  }
  return video.embedUrl.includes('/embed')
    ? video.embedUrl
    : `${video.embedUrl.replace(/\/+$/, '')}/embed`;
}

function getTikTokEmbedUrl(video: RecipeVideo): string {
  for (const raw of [video.embedUrl, video.url]) {
    const match = raw.match(
      /tiktok\.com\/(?:@[^/]+\/video|embed(?:\/v2)?|player\/v1)\/(\d+)/i
    );
    if (match) {
      return `https://www.tiktok.com/embed/v2/${match[1]}`;
    }
  }
  return video.embedUrl;
}

const PLATFORM_LABELS: Record<RecipeVideo['platform'], string> = {
  youtube: 'YouTube',
  instagram: 'Instagram',
  tiktok: 'TikTok',
  mp4: 'Wideo MP4',
};

function VideoPlayerCard({
  video,
  index,
}: {
  video: RecipeVideo;
  index: number;
}) {
  const title = video.title || `Wideo z przygotowania ${index + 1}`;

  if (video.platform === 'youtube') {
    const { src, isShort } = getYouTubeEmbedUrl(video);
    return (
      <div
        className={`mx-auto overflow-hidden rounded-2xl border border-[#EAE5DF] bg-[#1F2421] shadow-xs ${
          isShort ? 'aspect-[9/16] w-full max-w-[360px]' : 'aspect-video w-full'
        }`}
      >
        <iframe
          src={src}
          title={title}
          loading="lazy"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
          referrerPolicy="strict-origin-when-cross-origin"
          allowFullScreen
          className="h-full w-full border-0"
        />
      </div>
    );
  }

  if (video.platform === 'instagram') {
    const src = getInstagramEmbedUrl(video);
    return (
      <div className="mx-auto aspect-[9/16] min-h-[480px] w-full max-w-[400px] overflow-hidden rounded-2xl border border-[#EAE5DF] bg-white shadow-xs">
        <iframe
          src={src}
          title={title}
          loading="lazy"
          allow="autoplay; clipboard-write; encrypted-media; picture-in-picture; web-share"
          allowFullScreen
          className="h-full w-full border-0"
        />
      </div>
    );
  }

  if (video.platform === 'tiktok') {
    const src = getTikTokEmbedUrl(video);
    return (
      <div className="mx-auto aspect-[9/16] min-h-[520px] w-full max-w-[360px] overflow-hidden rounded-2xl border border-[#EAE5DF] bg-[#1F2421] shadow-xs">
        <iframe
          src={src}
          title={title}
          loading="lazy"
          allow="encrypted-media;"
          allowFullScreen
          className="h-full w-full border-0"
        />
      </div>
    );
  }

  const mp4Src = withBase(video.embedUrl || video.url);
  return (
    <div className="aspect-video w-full overflow-hidden rounded-2xl border border-[#EAE5DF] bg-black shadow-xs">
      <video
        src={mp4Src}
        controls
        playsInline
        preload="metadata"
        className="h-full w-full object-contain"
      >
        Twoja przeglądarka nie obsługuje odtwarzacza wideo HTML5.
      </video>
    </div>
  );
}

export default function VideoEmbeds({ videos }: VideoEmbedsProps) {
  if (!videos || videos.length === 0) {
    return null;
  }

  return (
    <section aria-labelledby="videos-heading" className="space-y-4">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#C86D51]/10 text-[#C86D51]">
          <PlayCircle className="h-5 w-5" aria-hidden="true" />
        </div>
        <h2
          id="videos-heading"
          className="font-serif text-xl font-bold text-[#1F2421] sm:text-2xl"
        >
          Wideo z przygotowania
        </h2>
      </div>

      <div className="space-y-6">
        {videos.map((video, index) => (
          <div
            key={`${video.platform}-${video.url}-${index}`}
            className="rounded-2xl border border-[#EAE5DF] bg-white p-4 shadow-xs sm:p-5"
          >
            <VideoPlayerCard video={video} index={index} />

            <div className="mt-3 flex flex-wrap items-center justify-between gap-2 pt-1">
              <div className="min-w-0">
                <span className="inline-block rounded-md bg-[#FAF8F5] px-2 py-0.5 text-[11px] font-bold tracking-wide text-[#1F2421]/60 uppercase border border-[#EAE5DF]">
                  {PLATFORM_LABELS[video.platform]}
                </span>
                {video.title ? (
                  <p className="mt-1 text-sm font-semibold text-[#1F2421]">
                    {video.title}
                  </p>
                ) : null}
              </div>

              <a
                href={withBase(video.url)}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex min-h-[44px] items-center gap-1.5 rounded-xl px-3 text-xs font-semibold text-[#4A6B53] transition-colors hover:bg-[#EDF3EE] hover:text-[#3B5542] touch-manipulation"
              >
                <span>Otwórz oryginał</span>
                <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
              </a>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
