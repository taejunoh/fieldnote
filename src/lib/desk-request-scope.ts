type DeskRequestToken<S extends string> = {
  sport: S;
  selection: number;
  request: number;
};

/** Keep delayed responses tied to the selection and refresh that started them. */
export function createDeskRequestScope<S extends string>(initial: S) {
  let sport = initial;
  let selection = 0;
  let request = 0;
  const capture = (): DeskRequestToken<S> => ({ sport, selection, request });
  const isSelected = (token: DeskRequestToken<S>) =>
    token.sport === sport && token.selection === selection;
  return {
    capture,
    isSelected,
    isCurrent: (token: DeskRequestToken<S>) =>
      isSelected(token) && token.request === request,
    select(next: S) {
      sport = next;
      selection++;
      request++;
    },
    begin(slug: S) {
      if (slug !== sport) return null;
      request++;
      return capture();
    },
  };
}
