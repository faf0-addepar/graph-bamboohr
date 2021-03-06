import fetch, { Response } from 'node-fetch';
import { IntegrationProviderAuthenticationError } from '@jupiterone/integration-sdk-core';
import {
  IntegrationConfig,
  StatusError,
  BambooHRUser,
  BambooHRFilesResponse,
  BambooHRFile,
  BambooHREmployeeDetails,
  BambooHREmployeesMap,
} from './types';

export type ResourceIteratee<T> = (each: T) => Promise<void> | void;

export class APIClient {
  private readonly clientNamespace: string;
  private readonly clientAccessToken: string;

  constructor(readonly config: IntegrationConfig) {
    this.clientNamespace = config.clientNamespace;
    this.clientAccessToken = config.clientAccessToken;
  }

  private withBaseUri(path: string): string {
    return `https://api.bamboohr.com/api/gateway.php/${this.clientNamespace}/${path}`;
  }

  private async request(
    uri: string,
    method: 'GET' | 'HEAD' = 'GET',
  ): Promise<Response> {
    return await fetch(uri, {
      method,
      headers: {
        Accept: 'application/json',
        Authorization: `Basic ${Buffer.from(
          this.clientAccessToken + ':x',
        ).toString('base64')}`,
      },
    });
  }

  public async verifyAuthentication(): Promise<void> {
    try {
      const response = await this.request(
        this.withBaseUri('v1/employees/0'),
        'GET',
      );

      if (response.status !== 200) {
        throw new StatusError({
          message: 'Provider authentication failed',
          statusCode: response.status,
          statusText: response.statusText,
        });
      }
    } catch (err) {
      throw new IntegrationProviderAuthenticationError({
        cause: err,
        endpoint: `https://api.bamboohr.com/api/gateway.php/${this.clientNamespace}/v1/employees/0`,
        status: err.options ? err.options.statusCode : -1,
        statusText: err.options ? err.options.statusText : '',
      });
    }
  }

  /**
   * Iterates each user resource in the provider.
   *
   * @param iteratee receives each resource to produce entities/relationships
   */
  public async iterateUsers(
    iteratee: ResourceIteratee<BambooHRUser>,
  ): Promise<void> {
    const usersResponse = await this.request(this.withBaseUri('v1/meta/users'));
    const usersObject = await usersResponse.json();
    const users: BambooHRUser[] = Object.values(usersObject);
    const employees = await this.fetchEmployeeDirectory();

    for (const user of users) {
      await iteratee({
        ...user,
        employeeDetails: employees[user.employeeId] || {},
      });
    }
  }

  private async fetchEmployeeDirectory(): Promise<BambooHREmployeesMap> {
    const employeesResponse = await this.request(
      this.withBaseUri('v1/employees/directory'),
    );
    const employeesObject = await employeesResponse.json();
    return employeesObject.employees.reduce(
      (acc: BambooHREmployeesMap, cur: BambooHREmployeeDetails) => {
        acc[cur.id] = cur;
        return acc;
      },
      {} as BambooHREmployeesMap,
    );
  }

  /**
   * Iterates each employee file in the provider.
   *
   * @param iteratee receives each resource to produce entities/relationships
   */
  public async iterateEmployeeFiles(
    employeeId: string,
    iteratee: ResourceIteratee<BambooHRFile>,
  ): Promise<void> {
    const response = await this.request(
      this.withBaseUri(`v1/employees/${employeeId}/files/view`),
    );

    if (response.ok) {
      const files: BambooHRFilesResponse = await response.json();
      const categoryFiles = files.categories.reduce(
        (acc, category) => acc.concat(category.files),
        [] as BambooHRFile[],
      );

      for (const file of categoryFiles) {
        await iteratee(file);
      }
    }
  }

  /**
   * Iterates each company file in the provider
   *
   * @param iteratee receives each resource to produce entities/relationships
   */
  public async iterateCompanyFiles(
    iteratee: ResourceIteratee<BambooHRFile>,
  ): Promise<void> {
    const response = await this.request(this.withBaseUri(`v1/files/view`));

    if (response.ok) {
      const files: BambooHRFilesResponse = await response.json();
      const categoryFiles = files.categories.reduce(
        (acc, category) => acc.concat(category.files),
        [] as BambooHRFile[],
      );

      for (const file of categoryFiles) {
        await iteratee(file);
      }
    }
  }
}

export function createAPIClient(config: IntegrationConfig): APIClient {
  return new APIClient(config);
}
