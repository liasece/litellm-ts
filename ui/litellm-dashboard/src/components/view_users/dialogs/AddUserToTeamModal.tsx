import { Button, Form, Modal, Select, Tooltip } from "antd";
import type { TeamDisplayInfo, TeamOption } from "../types";

interface AddUserToTeamModalProps {
  open: boolean;
  allTeams: TeamOption[];
  currentTeams: TeamDisplayInfo[];
  selectedTeamId: string;
  selectedRole: string;
  loadingTeams: boolean;
  submitting: boolean;
  onSelectedTeamChange: (teamId: string) => void;
  onSelectedRoleChange: (role: string) => void;
  onCancel: () => void;
  onSubmit: () => void;
}

export default function AddUserToTeamModal({
  open,
  allTeams,
  currentTeams,
  selectedTeamId,
  selectedRole,
  loadingTeams,
  submitting,
  onSelectedTeamChange,
  onSelectedRoleChange,
  onCancel,
  onSubmit,
}: AddUserToTeamModalProps) {
  const availableTeams = allTeams.filter(
    (team) => !currentTeams.some((currentTeam) => currentTeam.team_id === team.team_id),
  );

  return (
    <Modal
      title="Add User to Team"
      open={open}
      onCancel={onCancel}
      footer={null}
      width={500}
      maskClosable={!submitting}
    >
      <Form layout="vertical" onFinish={onSubmit}>
        <Form.Item label="Team" required>
          <Select
            showSearch
            value={selectedTeamId || undefined}
            onChange={onSelectedTeamChange}
            placeholder="Select a team"
            filterOption={(input, option) => {
              const team = availableTeams.find((item) => item.team_id === option?.value);
              return team ? team.team_alias.toLowerCase().includes(input.toLowerCase()) : false;
            }}
            loading={loadingTeams}
            options={availableTeams.map((team) => ({ value: team.team_id, label: team.team_alias }))}
          />
        </Form.Item>

        <Form.Item label="Member Role">
          <Select value={selectedRole} onChange={onSelectedRoleChange}>
            <Select.Option value="user">
              <Tooltip title="Can view team info, but not manage it">
                <span className="font-medium">user</span>
                <span className="ml-2 text-sm text-gray-500">- Can view team info, but not manage it</span>
              </Tooltip>
            </Select.Option>
            <Select.Option value="admin">
              <Tooltip title="Can create team keys, add members, and manage settings">
                <span className="font-medium">admin</span>
                <span className="ml-2 text-sm text-gray-500">
                  - Can create team keys, add members, and manage settings
                </span>
              </Tooltip>
            </Select.Option>
          </Select>
        </Form.Item>

        <div className="mt-4 text-right">
          <Button type="primary" htmlType="submit" loading={submitting} disabled={!selectedTeamId}>
            {submitting ? "Adding..." : "Add to Team"}
          </Button>
        </div>
      </Form>
    </Modal>
  );
}
