// Definições de filtros das listas (usadas por páginas do servidor e pela barra de busca).

export type ToolbarFilter = {
  name: string;
  label: string;
  value: string;
  options: { value: string; label: string }[];
};

export const STATUS_FILTER = (value: string): ToolbarFilter => ({
  name: 'status',
  label: 'Situação',
  value,
  options: [
    { value: 'ativos', label: 'Ativos' },
    { value: 'inativos', label: 'Excluídos' },
    { value: 'todos', label: 'Todos' },
  ],
});
