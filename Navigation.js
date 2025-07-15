// Navigation.js
import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';

import AuthScreen from './components/AuthScreen';
import SeleccionarPlaza from './components/SeleccionarPlaza';
import FormularioActivacion from './components/FormularioActivacion';
import FormulariosPorImpulsador from './components/FormulariosPorImpulsador';

const Stack = createNativeStackNavigator();

export default function Navigation({ usuario, setUsuario, plazaSeleccionada, setPlazaSeleccionada }) {
  return (
    <NavigationContainer>
      <Stack.Navigator>
        {!usuario ? (
          <Stack.Screen name="Login" options={{ headerShown: false }}>
            {() => <AuthScreen onLogin={setUsuario} />}
          </Stack.Screen>
        ) : !plazaSeleccionada ? (
          <Stack.Screen name="SeleccionarPlaza" options={{ title: 'Seleccionar Plaza' }}>
            {() => <SeleccionarPlaza onSeleccionar={setPlazaSeleccionada} />}
          </Stack.Screen>
        ) : (
          <>
            <Stack.Screen name="FormularioActivacion" options={{ title: 'Formulario' }}>
              {() => (
                <FormularioActivacion
                  usuario={usuario}
                  plaza={plazaSeleccionada}
                />
              )}
            </Stack.Screen>
            <Stack.Screen
              name="FormulariosPorImpulsador"
              component={FormulariosPorImpulsador}
              options={{ title: 'Mis Formularios' }}
            />
          </>
        )}
      </Stack.Navigator>
    </NavigationContainer>
  );
}
