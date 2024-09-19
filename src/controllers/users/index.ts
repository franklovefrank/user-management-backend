import type { NextFunction, Response } from 'express';
import createHttpError from 'http-errors';

import { AppDataSource } from '../../data-source';
import { User } from '../../entities/user';
import type { PasswordUpdateBody, UsersCreateBody, UsersUpdateBody } from '../../types/routes/users';
import { validateCreateBody } from './validators';
import { updateUser, updateUserPassword } from '../../services/user';

const create = async (req: TypedRequestBody<UsersCreateBody>, res: Response, next: NextFunction) => {
    const { username, email, mobile, password } = validateCreateBody(req.body);

    // Create a query runner to control the transactions, it allows to cancel the transaction if we need to
    const queryRunner = AppDataSource.createQueryRunner();

    // Logging the database connection details
    console.log('Database Connection Details:', {
        type: AppDataSource.options.type,
        database: AppDataSource.options.database,
    });

    // Connect the query runner to the database and start the transaction
    await queryRunner.connect();
    await queryRunner.startTransaction();
    console.log('Transaction started.');

    try {
        const userRepo = queryRunner.manager.getRepository(User);

        // Check if username exists and log the query
        const usernameExists = await userRepo.exist({
            where: { username }
        });
        console.log('Username exists check:', { usernameExists, username });
        if (usernameExists) {
            throw createHttpError(409, 'Username already exists');
        }

        // Check if email exists and log the query
        const emailExists = await userRepo.exist({
            where: { email }
        });
        console.log('Email exists check:', { emailExists, email });
        if (emailExists) {
            throw createHttpError(409, 'Email already exists');
        }

        // Log before creating a new user
        console.log('Creating new user:', { username, email, mobile });
        const newUser = new User();
        newUser.username = username;
        newUser.email = email;
        newUser.mobile = mobile;
        newUser.setPassword(password);
        await queryRunner.manager.save(newUser);

        console.log('New user saved:', { userId: newUser.id });

        // No exceptions occurred, so we commit the transaction
        await queryRunner.commitTransaction();
        console.log('Transaction committed successfully.');

        res.send(newUser.id);
    } catch (err) {
        console.error('Error occurred, rolling back transaction:', err);
        await queryRunner.rollbackTransaction();
        throw err;
    } finally {
        console.log('Releasing query runner.');
        await queryRunner.release();
    }
};

/**
 * Updates the authenticated user's details.
 * @param req - Express request object
 * @param res - Express response object
 * @param next - Express next function
 */

export const updateUserDetails = async (
    req: TypedRequestBody<UsersUpdateBody>,
    res: Response,
    next: NextFunction
) => {
    const user = req.user; // Assumes `req.user` contains user information from authentication middleware

    if (!user || !user.id) {
        return next(createHttpError(401, 'User not authenticated'));
    }

    const { desired_username, desired_email } = req.body;

    try {
        const updatedDetails: Partial<UsersUpdateBody> = {};
        if (desired_username) {
            updatedDetails.desired_username = desired_username;
        }
        if (desired_email) {
            updatedDetails.desired_email = desired_email;
        }

        // Update user details
        if (Object.keys(updatedDetails).length > 0) {
            await updateUser(user.id, updatedDetails);
        }

        res.send({ message: 'User details updated successfully' });
    } catch (error) {
        next(error);
    }
};


export const updatePassword = async (
    req: TypedRequestBody<PasswordUpdateBody>,
    res: Response,
    next: NextFunction
) => {
    const user = req.user; // Assumes `req.user` contains user information from authentication middleware

    if (!user || !user.id) {
        return next(createHttpError(401, 'User not authenticated'));
    }

    const { desired_password } = req.body;

    if (!req.session.twoFAStatus) {
        return next(createHttpError(403, '2FA is required to update password'));
    }

    try {
        if (!desired_password) {
            return next(createHttpError(400, 'new password not provided'));
        }
    
        // Update the password
        await updateUserPassword(user.id, desired_password);

        req.session.twoFAStatus = false; // Reset 2FA status
        res.send({ message: 'Password updated successfully' });
    } catch (error) {
        next(createHttpError(500, 'Failed to update password'));
    }
};


export default {
    create,
    updateUserDetails
};
