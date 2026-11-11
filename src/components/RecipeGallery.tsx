import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { ChevronLeft, ChevronRight, ImageOff } from 'lucide-react';
import { getCategoryMeta, type RecipeCategory } from '../constants/categories';
import type { RecipeImage } from '../types/recipe';
import { withBase } from '../utils/paths';
import { orderImagesWithMainFirst } from '../utils/recipe';

export interface RecipeGalleryProps {
  images: RecipeImage[];
  title: string;
  category?: RecipeCategory;
}

interface GallerySlideImageProps {
  image: RecipeImage;
  fallbackTitle: string;
  category?: RecipeCategory;
  priority?: boolean;
  className?: string;
}

function GallerySlideImage({
  image,
  fallbackTitle,
  category,
  priority = false,
  className = '',
}: GallerySlideImageProps) {
  const resolvedSrc = image.url ? withBase(image.url) : '';
  const [hasError, setHasError] = useState(!resolvedSrc);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const categoryMeta = category ? getCategoryMeta(category) : undefined;
  const CategoryIcon = categoryMeta?.icon ?? ImageOff;

  useEffect(() => {
    if (!resolvedSrc) {
      setHasError(true);
      return;
    }

    setHasError(false);

    const imgEl = imgRef.current;
    if (imgEl && imgEl.complete && imgEl.naturalWidth === 0) {
      setHasError(true);
    }
  }, [resolvedSrc]);

  if (hasError || !resolvedSrc) {
    return (
      <div
        className={`flex h-full w-full flex-col items-center justify-center gap-3 bg-gradient-to-br from-[#FAF8F5] via-[#F2EDE4] to-[#E6DFD5] px-6 text-center ${className}`}
      >
        <div
          className="flex h-14 w-14 items-center justify-center rounded-2xl border border-[#EAE5DF] bg-white/85 shadow-xs"
          style={categoryMeta ? { color: categoryMeta.accentColor } : undefined}
        >
          <CategoryIcon className="h-7 w-7" aria-hidden="true" />
        </div>
        <p className="text-sm font-medium text-[#1F2421]/60">
          {image.caption || 'Nie udało się wczytać zdjęcia potrawy'}
        </p>
      </div>
    );
  }

  return (
    <img
      ref={imgRef}
      src={resolvedSrc}
      alt={image.caption || fallbackTitle}
      loading={priority ? 'eager' : 'lazy'}
      decoding="async"
      onError={() => setHasError(true)}
      className={`h-full w-full object-cover ${className}`}
    />
  );
}

export default function RecipeGallery({
  images,
  title,
  category,
}: RecipeGalleryProps) {
  const orderedImages = useMemo(
    () => orderImagesWithMainFirst(images),
    [images]
  );
  const [activeIndex, setActiveIndex] = useState(0);
  const trackRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setActiveIndex(0);
    if (trackRef.current) {
      trackRef.current.scrollTo({ left: 0, behavior: 'auto' });
    }
  }, [orderedImages]);

  if (orderedImages.length === 0) {
    return null;
  }

  if (orderedImages.length === 1) {
    const singleImage = orderedImages[0];
    return (
      <figure className="space-y-2.5">
        <div className="relative aspect-[4/3] w-full max-h-[520px] overflow-hidden rounded-2xl border border-[#EAE5DF] bg-[#F3EEE7] shadow-sm sm:aspect-[16/9] sm:rounded-3xl">
          <GallerySlideImage
            image={singleImage}
            fallbackTitle={title}
            category={category}
            priority
          />
        </div>
        {singleImage.caption ? (
          <figcaption className="px-1 text-xs leading-relaxed text-[#1F2421]/65 sm:text-sm">
            {singleImage.caption}
          </figcaption>
        ) : null}
      </figure>
    );
  }

  const total = orderedImages.length;
  const safeIndex = Math.min(activeIndex, total - 1);
  const activeImage = orderedImages[safeIndex];

  function goToSlide(nextIndex: number) {
    const wrappedIndex = ((nextIndex % total) + total) % total;
    setActiveIndex(wrappedIndex);

    const track = trackRef.current;
    if (track) {
      track.scrollTo({
        left: wrappedIndex * track.clientWidth,
        behavior: 'smooth',
      });
    }
  }

  function handleTrackScroll() {
    const track = trackRef.current;
    if (!track || track.clientWidth === 0) {
      return;
    }
    const index = Math.round(track.scrollLeft / track.clientWidth);
    const clamped = Math.max(0, Math.min(total - 1, index));
    setActiveIndex((prev) => (prev === clamped ? prev : clamped));
  }

  function handleKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      goToSlide(safeIndex - 1);
    } else if (event.key === 'ArrowRight') {
      event.preventDefault();
      goToSlide(safeIndex + 1);
    }
  }

  return (
    <figure
      aria-roledescription="karuzela"
      aria-label={`Galeria zdjęć: ${title}`}
      tabIndex={0}
      onKeyDown={handleKeyDown}
      className="space-y-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#4A6B53] focus-visible:ring-offset-4 focus-visible:ring-offset-[#FAF8F5] rounded-3xl"
    >
      <div className="relative overflow-hidden rounded-2xl border border-[#EAE5DF] bg-[#F3EEE7] shadow-sm sm:rounded-3xl">
        {/* Swipeable scroll-snap track (native momentum on iPhone) */}
        <div
          ref={trackRef}
          onScroll={handleTrackScroll}
          className="no-scrollbar flex snap-x snap-mandatory overflow-x-auto overscroll-x-contain"
        >
          {orderedImages.map((img, index) => (
            <div
              key={`${img.url}-${index}`}
              className="aspect-[4/3] w-full max-h-[520px] shrink-0 snap-center snap-always sm:aspect-[16/9]"
            >
              <GallerySlideImage
                image={img}
                fallbackTitle={`${title} — zdjęcie ${index + 1}`}
                category={category}
                priority={index === 0}
              />
            </div>
          ))}
        </div>

        {/* Slide counter badge */}
        <div
          aria-live="polite"
          className="pointer-events-none absolute top-3 right-3 rounded-full border border-white/15 bg-[#1F2421]/75 px-3 py-1 text-xs font-semibold text-white tabular-nums shadow-sm backdrop-blur-xs"
        >
          {safeIndex + 1} / {total}
        </div>

        {/* Prev / Next touch-friendly buttons */}
        <button
          type="button"
          onClick={() => goToSlide(safeIndex - 1)}
          aria-label="Poprzednie zdjęcie"
          className="absolute top-1/2 left-2.5 flex min-h-[44px] min-w-[44px] -translate-y-1/2 cursor-pointer items-center justify-center rounded-full border border-[#EAE5DF]/80 bg-white/90 text-[#1F2421] shadow-md backdrop-blur-xs transition-all hover:bg-white active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#4A6B53] sm:left-4 touch-manipulation"
        >
          <ChevronLeft className="h-5 w-5" aria-hidden="true" />
        </button>

        <button
          type="button"
          onClick={() => goToSlide(safeIndex + 1)}
          aria-label="Następne zdjęcie"
          className="absolute top-1/2 right-2.5 flex min-h-[44px] min-w-[44px] -translate-y-1/2 cursor-pointer items-center justify-center rounded-full border border-[#EAE5DF]/80 bg-white/90 text-[#1F2421] shadow-md backdrop-blur-xs transition-all hover:bg-white active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#4A6B53] sm:right-4 touch-manipulation"
        >
          <ChevronRight className="h-5 w-5" aria-hidden="true" />
        </button>
      </div>

      {/* Active slide caption */}
      {activeImage?.caption ? (
        <figcaption className="px-1 text-xs leading-relaxed text-[#1F2421]/70 sm:text-sm">
          {activeImage.caption}
        </figcaption>
      ) : null}

      {/* Thumbnail selector strip */}
      <div className="no-scrollbar flex items-center gap-2.5 overflow-x-auto pb-1">
        {orderedImages.map((img, index) => {
          const isActive = index === safeIndex;
          return (
            <button
              key={`thumb-${img.url}-${index}`}
              type="button"
              onClick={() => goToSlide(index)}
              aria-label={`Pokaż zdjęcie ${index + 1}${img.caption ? `: ${img.caption}` : ''}`}
              aria-current={isActive ? 'true' : undefined}
              className={`relative h-12 w-20 shrink-0 cursor-pointer overflow-hidden rounded-xl border-2 transition-all active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#4A6B53] sm:h-16 sm:w-24 touch-manipulation ${
                isActive
                  ? 'border-[#4A6B53] shadow-sm ring-2 ring-[#4A6B53]/25'
                  : 'border-[#EAE5DF] opacity-70 hover:opacity-100'
              }`}
            >
              <GallerySlideImage
                image={img}
                fallbackTitle={`Miniatura ${index + 1}`}
                category={category}
              />
            </button>
          );
        })}
      </div>
    </figure>
  );
}
