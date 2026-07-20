/** Time-of-day greeting; appends the name when one is set. Shared by onboarding + panel. */
export function greeting(name: string): string {
  const h = new Date().getHours()
  const hello =
    h < 5 ? 'Доброй ночи' : h < 12 ? 'Доброе утро' : h < 18 ? 'Добрый день' : 'Добрый вечер'
  const who = name.trim()
  return who ? `${hello}, ${who}` : hello
}
