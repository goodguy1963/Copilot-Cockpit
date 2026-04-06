import * as assert from "assert";
import { CopilotExecutor } from "../../copilotExecutor";
import { refreshAgentsAndModels } from "../../copilotWebviewTemplateCache";
import type { AgentInfo, ModelInfo } from "../../types";

suite("SchedulerWebviewTemplateCache Tests", () => {
  test("refreshAgentsAndModels preserves cached custom lists when refresh is empty", async () => {
    const executor = CopilotExecutor as unknown as {
      collectAllAgents: () => Promise<unknown[]>;
      collectAvailableModels: () => Promise<unknown[]>;
      getBuiltInAgents: () => unknown[];
      builtinModels: () => unknown[];
    };

    const originalGetAllAgents = executor.collectAllAgents;
    const originalGetAvailableModels = executor.collectAvailableModels;
    const originalGetBuiltInAgents = executor.getBuiltInAgents;
    const originalGetFallbackModels = executor.builtinModels;

    const agentListCache: AgentInfo[] = [{
      id: "@custom-agent",
      name: "@custom-agent",
      description: "Custom agent",
      isCustom: true,
    }];
    const modelListCache: ModelInfo[] = [{
      id: "gpt-custom",
      name: "GPT Custom",
      description: "Custom model",
      vendor: "custom",
    }];

    try {
      executor.collectAllAgents = async () => [];
      executor.collectAvailableModels = async () => [];
      executor.getBuiltInAgents = () => [{
        id: "agent",
        name: "Built-in agent",
        description: "Built-in",
        isCustom: false,
      }];
      executor.builtinModels = () => [{
        id: "",
        name: "Default",
        description: "Default model",
        vendor: "",
      }];

      const result = await refreshAgentsAndModels(agentListCache, modelListCache, true);

      assert.deepStrictEqual(result.agents, agentListCache);
      assert.deepStrictEqual(result.models, modelListCache);
    } finally {
      executor.collectAllAgents = originalGetAllAgents;
      executor.collectAvailableModels = originalGetAvailableModels;
      executor.getBuiltInAgents = originalGetBuiltInAgents;
      executor.builtinModels = originalGetFallbackModels;
    }
  });

  test("refreshAgentsAndModels falls back only when cache is empty", async () => {
    const executor = CopilotExecutor as unknown as {
      collectAllAgents: () => Promise<unknown[]>;
      collectAvailableModels: () => Promise<unknown[]>;
      getBuiltInAgents: () => unknown[];
      builtinModels: () => unknown[];
    };

    const originalGetAllAgents = executor.collectAllAgents;
    const originalGetAvailableModels = executor.collectAvailableModels;
    const originalGetBuiltInAgents = executor.getBuiltInAgents;
    const originalGetFallbackModels = executor.builtinModels;

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
      executor.collectAllAgents = async () => {
        throw new Error("agent refresh failed");
      };
      executor.collectAvailableModels = async () => {
        throw new Error("model refresh failed");
      };
      executor.getBuiltInAgents = () => builtInAgents;
      executor.builtinModels = () => fallbackModels;

      const result = await refreshAgentsAndModels([], [], true);

      assert.deepStrictEqual(result.agents, builtInAgents);
      assert.deepStrictEqual(result.models, fallbackModels);
    } finally {
      executor.collectAllAgents = originalGetAllAgents;
      executor.collectAvailableModels = originalGetAvailableModels;
      executor.getBuiltInAgents = originalGetBuiltInAgents;
      executor.builtinModels = originalGetFallbackModels;
    }
  });
});