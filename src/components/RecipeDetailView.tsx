import {
  ArrowLeft,
  Clock,
  ExternalLink,
  Flame,
  Sparkles,
  Tag,
  Timer,
  Users,
} from 'lucide-react';
import { getCategoryMeta } from '../constants/categories';
import type { Recipe } from '../types/recipe';
import { withBase } from '../utils/paths';
import {
  DIFFICULTY_BADGE_CLASSES,
  formatServingsLabel,
  formatTotalTime,
} from '../utils/recipe';
import IngredientsList from './IngredientsList';
import RecipeGallery from './RecipeGallery';
import RecipeSteps from './RecipeSteps';
import VideoEmbeds from './VideoEmbeds';

export interface RecipeDetailViewProps {
  recipe: Recipe;
  backHref?: string;
  backLabel?: string;
  onBack?: () => void;
  isInstantPreview?: boolean;
}

export default function RecipeDetailView({
  recipe,
  backHref,
  backLabel = 'Wszystkie przepisy',
  onBack,
  isInstantPreview = false,
}: RecipeDetailViewProps) {
  const categoryMeta = getCategoryMeta(recipe.category);
  const CategoryIcon = categoryMeta.icon;
  const videos = recipe.videos ?? [];
  const chefTips = recipe.chefTips ?? [];
  const tags = recipe.tags ?? [];
  const resolvedBackHref = backHref ?? withBase('/');

  return (
    <article className="pb-12">
      {/* Back navigation */}
      <div className="mb-4 sm:mb-6">
        {onBack ? (
          <button
            type="button"
            onClick={onBack}
            className="inline-flex min-h-[44px] cursor-pointer items-center gap-2 rounded-xl border border-[#EAE5DF] bg-white px-4 py-2 text-sm font-semibold text-[#1F2421] shadow-xs transition-all hover:border-[#4A6B53]/40 hover:text-[#4A6B53] active:scale-[0.98] touch-manipulation focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#4A6B53]"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            <span>{backLabel}</span>
          </button>
        ) : (
          <a
            href={resolvedBackHref}
            className="inline-flex min-h-[44px] items-center gap-2 rounded-xl border border-[#EAE5DF] bg-white px-4 py-2 text-sm font-semibold text-[#1F2421] shadow-xs transition-all hover:border-[#4A6B53]/40 hover:text-[#4A6B53] active:scale-[0.98] touch-manipulation focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#4A6B53]"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            <span>{backLabel}</span>
          </a>
        )}
      </div>

      {/* Article Header: category, title, summary, metadata & source link */}
      <header className="space-y-4">
        <div className="flex flex-wrap items-center gap-2.5">
          {isInstantPreview ? (
            <span className="inline-flex items-center gap-1.5 rounded-lg border border-[#C9DBC9] bg-[#EDF3EE] px-3 py-1 text-xs font-bold text-[#3B5542]">
              <Sparkles className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <span>Nowość – właśnie dodano!</span>
            </span>
          ) : null}

          <span
            className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1 text-xs font-semibold ${categoryMeta.badgeClass}`}
          >
            <CategoryIcon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <span>{recipe.category}</span>
          </span>

          <span
            className={`inline-flex items-center rounded-lg border px-2.5 py-1 text-xs font-semibold ${DIFFICULTY_BADGE_CLASSES[recipe.difficulty]}`}
          >
            Trudność: {recipe.difficulty}
          </span>
        </div>

        <h1 className="font-serif text-3xl font-bold leading-[1.15] tracking-tight text-[#1F2421] sm:text-4xl lg:text-[2.65rem]">
          {recipe.title}
        </h1>

        <p className="max-w-3xl text-base leading-relaxed text-[#1F2421]/75 sm:text-lg">
          {recipe.summary}
        </p>

        {/* Metadata bar + Source link */}
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[#EAE5DF] bg-white p-3.5 shadow-xs sm:px-5 sm:py-4">
          <dl className="flex flex-wrap items-center gap-x-5 gap-y-2.5 text-xs font-medium text-[#1F2421]/75 sm:text-sm">
            {recipe.prepTimeMinutes !== undefined ? (
              <div className="flex items-center gap-1.5">
                <dt className="sr-only">Czas przygotowania</dt>
                <Timer
                  className="h-4 w-4 shrink-0 text-[#4A6B53]"
                  aria-hidden="true"
                />
                <dd>
                  <span className="text-[#1F2421]/55">Przygotowanie: </span>
                  <strong className="font-semibold text-[#1F2421]">
                    {formatTotalTime(recipe.prepTimeMinutes)}
                  </strong>
                </dd>
              </div>
            ) : null}

            {recipe.cookTimeMinutes !== undefined ? (
              <div className="flex items-center gap-1.5">
                <dt className="sr-only">Czas gotowania</dt>
                <Flame
                  className="h-4 w-4 shrink-0 text-[#C86D51]"
                  aria-hidden="true"
                />
                <dd>
                  <span className="text-[#1F2421]/55">Gotowanie: </span>
                  <strong className="font-semibold text-[#1F2421]">
                    {formatTotalTime(recipe.cookTimeMinutes)}
                  </strong>
                </dd>
              </div>
            ) : null}

            <div className="flex items-center gap-1.5">
              <dt className="sr-only">Czas całkowity</dt>
              <Clock
                className="h-4 w-4 shrink-0 text-[#4A6B53]"
                aria-hidden="true"
              />
              <dd>
                <span className="text-[#1F2421]/55">Łącznie: </span>
                <strong className="font-semibold text-[#1F2421]">
                  {formatTotalTime(recipe.totalTimeMinutes)}
                </strong>
              </dd>
            </div>

            <div className="flex items-center gap-1.5">
              <dt className="sr-only">Porcje</dt>
              <Users
                className="h-4 w-4 shrink-0 text-[#4A6B53]"
                aria-hidden="true"
              />
              <dd>
                <strong className="font-semibold text-[#1F2421]">
                  {formatServingsLabel(recipe.servings)}
                </strong>
              </dd>
            </div>
          </dl>

          <a
            href={recipe.sourceUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex min-h-[44px] items-center gap-1.5 rounded-xl border border-[#EAE5DF] bg-[#FAF8F5] px-3.5 py-2 text-xs font-semibold text-[#4A6B53] transition-all hover:border-[#4A6B53]/40 hover:bg-[#EDF3EE] hover:text-[#3B5542] active:scale-[0.98] sm:text-sm touch-manipulation focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#4A6B53]"
          >
            <span>Źródło: {recipe.sourceDomain}</span>
            <ExternalLink className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          </a>
        </div>
      </header>

      {/* Main Gallery */}
      <div className="mt-6 sm:mt-8">
        <RecipeGallery
          images={recipe.images}
          title={recipe.title}
          category={recipe.category}
        />
      </div>

      {/* Main Cookbook Content: Ingredients + Steps + Videos + Chef Tips */}
      <div className="mt-8 grid grid-cols-1 gap-8 lg:grid-cols-12 lg:items-start">
        <div className="lg:col-span-4 lg:sticky lg:top-24 lg:max-h-[calc(100dvh-7rem)] lg:overflow-y-auto no-scrollbar">
          <IngredientsList
            recipeSlug={recipe.slug}
            recipeTitle={recipe.title}
            baseServings={recipe.servings}
            ingredientGroups={recipe.ingredientGroups}
          />
        </div>

        <div className="space-y-8 lg:col-span-8">
          <RecipeSteps recipeSlug={recipe.slug} steps={recipe.steps} />

          <VideoEmbeds videos={videos} />

          {chefTips.length > 0 ? (
            <section
              aria-labelledby="chef-tips-heading"
              className="rounded-2xl border border-[#EED9B7] bg-[#FDF4E3]/65 p-5 shadow-xs sm:p-6"
            >
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#945B17]/10 text-[#945B17]">
                  <Sparkles className="h-5 w-5" aria-hidden="true" />
                </div>
                <h2
                  id="chef-tips-heading"
                  className="font-serif text-xl font-bold text-[#1F2421] sm:text-2xl"
                >
                  Wskazówki Szefa Kuchni
                </h2>
              </div>

              <ul className="mt-4 space-y-3">
                {chefTips.map((tip, index) => (
                  <li
                    key={index}
                    className="flex items-start gap-3 text-sm leading-relaxed text-[#1F2421]/85 sm:text-base"
                  >
                    <span
                      aria-hidden="true"
                      className="mt-2 h-2 w-2 shrink-0 rounded-full bg-[#C86D51]"
                    />
                    <span>{tip}</span>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {tags.length > 0 ? (
            <div className="flex flex-wrap items-center gap-2 border-t border-[#EAE5DF] pt-5">
              <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#1F2421]/55">
                <Tag className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Tagi:</span>
              </span>
              {tags.map((tag) => (
                <span
                  key={tag}
                  className="rounded-full border border-[#EAE5DF] bg-white px-3 py-1 text-xs font-medium text-[#1F2421]/75"
                >
                  #{tag}
                </span>
              ))}
            </div>
          ) : null}
        </div>
      </div>
    </article>
  );
}
