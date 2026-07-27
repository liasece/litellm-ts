import TablePaginationControls from "../../common_components/TablePaginationControls";

interface UserListPagination {
  users: unknown[];
  total: number;
  page: number;
  page_size: number;
  total_pages: number;
}

interface UserTablePaginationProps {
  loading: boolean;
  response?: UserListPagination;
  currentPage: number;
  onPageChange: (page: number) => void;
}

export default function UserTablePagination({
  loading,
  response,
  currentPage,
  onPageChange,
}: UserTablePaginationProps) {
  const start = response && response.users.length > 0 ? (response.page - 1) * response.page_size + 1 : 0;
  const end = response ? Math.min(response.page * response.page_size, response.total) : 0;

  return (
    <div className="flex items-center justify-between">
      {!loading && (
        <span className="text-sm text-gray-700">
          Showing {start} - {end} of {response?.total ?? 0} results
        </span>
      )}
      <TablePaginationControls
        loading={loading}
        pageIndex={currentPage - 1}
        pageCount={response?.total_pages ?? 1}
        canPreviousPage={currentPage > 1}
        canNextPage={Boolean(response && currentPage < response.total_pages)}
        onPreviousPage={() => onPageChange(currentPage - 1)}
        onNextPage={() => onPageChange(currentPage + 1)}
      />
    </div>
  );
}
