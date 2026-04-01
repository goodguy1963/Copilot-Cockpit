import * as assert from "assert";
import { CopilotExecutor } from "../../copilotExecutor";
import { refreshAgentsAndModels } from "../../schedulerWebviewTemplateCache";
import type { AgentInfo, ModelInfo } from "../../types";

suite("SchedulerWebviewTemplateCache Tests", () => {
  test("refreshAgentsAndModels preserves cached custom lists when refresh is empty", async () => {
    const executor = CopilotExecutor as unknown as {
      getAllAgents: () => Promise<unknown[]>;
      getAvailableModels: () => Promise<unknown[]>;
      getBuiltInAgents: () => unknown[];
      getFallbackModels: () => unknown[];
    };

    const originalGetAllAgents = executor.getAllAgents;
    const originalGetAvailableModels = executor.getAvailableModels;
    const originalGetBuiltInAgents = executor.getBuiltInAgents;
    const originalGetFallbackModels = executor.getFallbackModels;

    const cachedAgents: AgentInfo[] = [{
      id: "@custom-agent",
      name: "@custom-agent",
      description: "Custom agent",
      isCustom: true,
    }];
    const cachedModels: ModelInfo[] = [{
      id: "gpt-custom",
      name: "GPT Custom",
      description: "Custom model",
      vendor: "custom",
    }];

    try {
      executor.getAllAgents = async () => [];
      executor.getAvailableModels = async () => [];
      executor.getBuiltInAgents = () => [{
        id: "agent",
        name: "Built-in agent",
        description: "Built-in",
        isCustom: false,
      }];
      executor.getFallbackModels = () => [{
        id: "",
        name: "Default",
        description: "Default model",
        vendor: "",
      }];

      const result = await refreshAgentsAndModels(cachedAgents, cachedModels, true);

      assert.deepStrictEqual(result.agents, cachedAgents);
      assert.deepStrictEqual(result.models, cachedModels);
    } finally {
      executor.getAllAgents = originalGetAllAgents;
      executor.getAvailableModels = originalGetAvailableModels;
      executor.getBuiltInAgents = originalGetBuiltInAgents;
      executor.getFallbackModels = originalGetFallbackModels;
    }
  });

  test("refreshAgentsAndModels falls back only when cache is empty", async () => {
    const executor = CopilotExecutor as unknown as {
      getAllAgents: () => Promise<unknown[]>;
      getAvailableModels: () => Promise<unknown[]>;
      getBuiltInAgents: () => unknown[];
      getFallbackModels: () => unknown[];
    };

    const originalGetAllAgents = executor.getAllAgents;
    const originalGetAvailableModels = executor.getAvailableModels;
    const originalGetBuiltInAgents = executor.getBuiltInAgents;
    const originalGetFallbackModels = executor.getFallbackModels;

    const builtInAgents: AgentInfo[] = [{
      id: "agent",
      name: "Built-in agent",
      description: "Built-in",
      isCustom: false,
    }];
    const fallbackModels: ModelInfo[] = [{
      id: "",
      name: "Default",
      description: "Default model",
      vendor: "",
    }];

    try {
      executor.getAllAgents = async () => {
        throw new Error("agent refresh failed");
      };
      executor.getAvailableModels = async () => {
        throw new Error("model refresh failed");
      };
      executor.getBuiltInAgents = () => builtInAgents;
      executor.getFallbackModels = () => fallbackModels;

      const result = await refreshAgentsAndModels([], [], true);

      assert.deepStrictEqual(result.agents, builtInAgents);
      assert.deepStrictEqual(result.models, fallbackModels);
    } finally {
      executor.getAllAgents = originalGetAllAgents;
      executor.getAvailableModels = originalGetAvailableModels;
      executor.getBuiltInAgents = originalGetBuiltInAgents;
      executor.getFallbackModels = originalGetFallbackModels;
    }
  });
});