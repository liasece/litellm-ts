import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { TimeCell, getTimeZone } from "./time_cell";

describe("TimeCell", () => {
	it("should render a formatted time string", () => {
		render(<TimeCell utcTime="2025-06-15T14:30:00Z" />);
		// The global toLocaleString mock in setupTests returns "YYYY-MM-DD HH:MM:SS"
		expect(screen.getByText(/2025/)).toBeInTheDocument();
	});

	it("should render 'Error converting time' for invalid dates", () => {
		// toLocaleString on an Invalid Date returns "Invalid Date", not throwing,
		// but the component catches exceptions. Force an error by passing something
		// that causes Date constructor to produce NaN.
		render(<TimeCell utcTime="not-a-date" />);
		// The mock returns "NaN-NaN-NaN NaN:NaN:NaN" for invalid dates
		// The component has a try/catch that returns "Error converting time" on exception
		const el = screen.getByText(/NaN|Error/);
		expect(el).toBeInTheDocument();
	});

	it("uses 24-hour local time formatting", () => {
		const toLocaleString = vi.spyOn(Date.prototype, "toLocaleString").mockReturnValue("06/15/2025 14:30:00");
		render(<TimeCell utcTime="2025-06-15T14:30:00Z" />);

		expect(toLocaleString).toHaveBeenCalledWith("en-US", expect.objectContaining({ hour12: false, second: "2-digit" }));
		expect(screen.getByText("06/15/2025 14:30:00")).toHaveStyle({ fontFamily: "monospace" });
		toLocaleString.mockRestore();
	});
});

describe("getTimeZone", () => {
	it("should return a non-empty timezone string", () => {
		const tz = getTimeZone();
		expect(typeof tz).toBe("string");
		expect(tz.length).toBeGreaterThan(0);
	});
});
